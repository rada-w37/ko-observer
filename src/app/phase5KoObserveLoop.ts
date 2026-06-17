import type { Firestore } from "firebase-admin/firestore";
import type { AppConfig } from "./config.js";
import {
  initializePhase5KoObserverRun,
  writeCastleKoDetail,
  writeGuildKoTotals,
} from "../firestore/koObserverKoRepository.js";
import {
  loadMonitorGuildTargetFromGuildShares,
} from "../firestore/guildShareRepository.js";
import {
  createNotificationCoordinator,
} from "../notifications/application/createNotificationCoordinator.js";
import type {
  NotificationCoordinator,
} from "../notifications/application/notificationCoordinator.js";
import {
  createFallbackBaseName,
  type NotificationBattleType,
  type NotificationObservation,
} from "../notifications/domain/notificationDomain.js";
import { GvgRealtimeClient } from "../mentemori/realtimeClient.js";
import {
  parseRealtimePayload,
  type RawCastleStatusMessage,
  type RealtimePayloadBytes,
} from "../mentemori/realtimeParser.js";
import {
  createGrandBattleSubscriptionPayload,
  createGuildBattleSubscriptionPayload,
  decodeGvgStreamId,
} from "../mentemori/streamId.js";
import {
  resolveBattleSubscriptionScope,
  type BattleSubscriptionScope,
} from "../koo/battleScopeResolver.js";
import {
  applyKoObservation,
  calculateGuildKoTotals,
  createKoCastlePublicSnapshot,
  type KoCastleState,
} from "../koo/koAttribution.js";
import { logger } from "../shared/logger.js";

type Phase5KoObserveLoopDependencies = {
  createRealtimeClient?: () => GvgRealtimeClient;
  initializePhase5KoObserverRun?: typeof initializePhase5KoObserverRun;
  writeCastleKoDetail?: typeof writeCastleKoDetail;
  writeGuildKoTotals?: typeof writeGuildKoTotals;
  resolveBattleSubscriptionScope?: typeof resolveBattleSubscriptionScope;
  loadMonitorGuildTargetFromGuildShares?: typeof loadMonitorGuildTargetFromGuildShares;
  createNotificationCoordinator?: typeof createNotificationCoordinator;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
};

const GUILD_TOTAL_UPDATE_INTERVAL_MILLISECONDS = 5000;
const LOOP_SLEEP_MILLISECONDS = 250;
const DEBUG_LOG_SAMPLE_LIMIT = 10;
const DEBUG_HEX_DUMP_BYTES = 32;
const NOTIFICATION_FLUSH_TIMEOUT_MILLISECONDS = 5000;

export async function runPhase5KoObserveLoop(
  config: AppConfig,
  firestore: Firestore,
  dependencies: Phase5KoObserveLoopDependencies = {},
): Promise<void> {
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? sleepMilliseconds;
  const initializeRun =
    dependencies.initializePhase5KoObserverRun ?? initializePhase5KoObserverRun;
  const persistCastleKoDetail = dependencies.writeCastleKoDetail ?? writeCastleKoDetail;
  const persistGuildKoTotals = dependencies.writeGuildKoTotals ?? writeGuildKoTotals;
  const resolveSubscriptionScope =
    dependencies.resolveBattleSubscriptionScope ?? resolveBattleSubscriptionScope;
  const loadMonitorGuildTarget =
    dependencies.loadMonitorGuildTargetFromGuildShares ?? loadMonitorGuildTargetFromGuildShares;
  const initializeNotificationCoordinator =
    dependencies.createNotificationCoordinator ?? createNotificationCoordinator;
  const realtimeClient = (dependencies.createRealtimeClient ?? (() => new GvgRealtimeClient()))();
  const guildNames = new Map<string, string>();
  const castleStates = new Map<number, KoCastleState>();
  const startedAt = now();
  const endAtMilliseconds = startedAt.getTime() + config.observeDurationSeconds * 1000;
  const counters = {
    websocketOpened: false,
    subscriptionSent: false,
    websocketMessageReceivedCount: 0,
    guildMessageCount: 0,
    parsedMessageCount: 0,
    parsedCastleStatusCount: 0,
    unknownMessageCount: 0,
    parseErrorCount: 0,
    castleKoDetailsWriteCount: 0,
    guildKoTotalsUpdateCount: 0,
    unknownVictimKoAdds: 0,
  };
  const debugLogState = {
    messageReceivedCount: 0,
    parsedPayloadCount: 0,
    castleStatusCount: 0,
    decisionCount: 0,
  };
  let nextGuildTotalUpdateAt = startedAt.getTime() + GUILD_TOTAL_UPDATE_INTERVAL_MILLISECONDS;
  let guildTotalsDirty = false;
  let payloadProcessing: Promise<void> = Promise.resolve();

  const monitorTarget = await resolveMonitorTarget(config, firestore, loadMonitorGuildTarget);
  if (monitorTarget.status !== "ok") {
    logger.warn(monitorTarget.message);
    return;
  }

  const worldId = monitorTarget.worldId;
  logger.info(
    `monitor target resolved source=${monitorTarget.source} worldId=${monitorTarget.worldId} guildId=${monitorTarget.guildId ?? ""} guildName=${monitorTarget.guildName ?? ""}`,
  );

  const subscriptionScope = await resolveSubscriptionScope({
    worldId,
    guildId: monitorTarget.guildId ?? undefined,
  });
  logger.info(createScopeLogMessage("battle scope resolved", subscriptionScope));

  if (subscriptionScope.subscriptionType === "none") {
    logger.warn(`Phase5 subscription skipped reason=${subscriptionScope.reason}`);
    logSummary(subscriptionScope, counters, config.observeDurationSeconds);
    logger.info("Phase5 KO observe loop completed.");
    return;
  }

  const resolveRealtimeGuildId = createRealtimeGuildIdResolver(subscriptionScope);
  seedParticipantGuildNames(subscriptionScope);
  const notificationCoordinator = await initializeNotificationCoordinator({
    firestore,
    config,
    guildId: subscriptionScope.guildId,
  });
  const subscriptionPayload = createSubscriptionPayload(subscriptionScope);
  const initializeResult = await initializeRun(firestore, startedAt);
  logger.info(
    `startup clear completed castleKoDetails=${initializeResult.deletedCastleKoDetailsCount} guildKoTotals=${initializeResult.deletedGuildKoTotalsCount}`,
  );
  logger.info(`meta lastStartedAt saved value=${startedAt.toISOString()}`);
  if (subscriptionScope.subscriptionType === "grandBattle") {
    const initializedCount = await writeInitialGrandBattleGuildTotals(subscriptionScope, startedAt);
    counters.guildKoTotalsUpdateCount += initializedCount;
    logger.info(
      [
        `Grand Battle guildKoTotals initialized count=${initializedCount}`,
        `guildIds=${subscriptionScope.participantGuilds.map((guild) => guild.guildId).join(",")}`,
      ].join(" "),
    );
  }

  realtimeClient.addEventListener((event) => {
    if (event.type === "opened") {
      counters.websocketOpened = true;
      logger.info("websocket opened");
      return;
    }

    if (event.type === "subscriptionSent") {
      counters.subscriptionSent = true;
      logger.info("subscription sent");
      return;
    }

    if (event.type === "disconnected") {
      logger.info(`websocket closed reason=${event.reason ?? "unknown"}`);
      return;
    }

    if (event.type === "payloadReceived") {
      counters.websocketMessageReceivedCount += 1;
      logReceivedPayload(event.payload, counters.websocketMessageReceivedCount);
      payloadProcessing = payloadProcessing
        .then(() => handlePayload(event.payload, now()))
        .catch((error: unknown) => {
          logger.error("Phase5 payload handling failed.", error);
        });
      return;
    }

    if (event.type === "error") {
      logger.error("Phase5 realtime client error.", event.error);
    }
  });

  logger.info(
    `Phase5 KO observe loop started durationSeconds=${config.observeDurationSeconds}`,
  );
  logger.info(createScopeLogMessage("websocket connecting", subscriptionScope));
  logSubscriptionPayload(subscriptionScope, subscriptionPayload);
  await realtimeClient.connect({ payload: subscriptionPayload });

  try {
    while (now().getTime() < endAtMilliseconds) {
      await payloadProcessing;
      if (guildTotalsDirty && now().getTime() >= nextGuildTotalUpdateAt) {
        await writeCurrentGuildTotals(now());
        nextGuildTotalUpdateAt = now().getTime() + GUILD_TOTAL_UPDATE_INTERVAL_MILLISECONDS;
      }

      await sleep(LOOP_SLEEP_MILLISECONDS);
    }

    await payloadProcessing;
    if (guildTotalsDirty) {
      await writeCurrentGuildTotals(now());
    }
  } finally {
    realtimeClient.disconnect("duration reached");
    await flushNotificationCoordinatorSafely(notificationCoordinator);
  }

  logSummary(subscriptionScope, counters, config.observeDurationSeconds);
  logger.info("Phase5 KO observe loop completed.");

  async function handlePayload(payload: RealtimePayloadBytes, receivedAt: Date): Promise<void> {
    const parserResult = parseRealtimePayload(payload);
    if (parserResult.status === "error") {
      counters.parseErrorCount += 1;
      logger.warn(`Phase5 realtime parser error: ${parserResult.error.message}`);
    }

    const guildMessages = parserResult.messages.filter((message) => message.type === "guild");
    const castleStatusMessages = parserResult.messages.filter(
      (message) => message.type === "castleStatus",
    );
    const unknownMessages = parserResult.messages.filter((message) => message.type === "unknown");
    counters.parsedMessageCount += parserResult.messages.length;
    counters.guildMessageCount += guildMessages.length;
    counters.parsedCastleStatusCount += castleStatusMessages.length;
    counters.unknownMessageCount += unknownMessages.length;
    logParsedPayload(
      parserResult.messages.length,
      guildMessages.length,
      castleStatusMessages.length,
      unknownMessages.length,
    );

    for (const message of parserResult.messages) {
      if (message.type === "guild" && message.guildId && message.guildName) {
        guildNames.set(resolveRealtimeGuildId(message.guildId), message.guildName);
      }

      if (message.type !== "castleStatus") {
        continue;
      }

      const previousState = castleStates.get(message.castleId);
      const ownerGuildId = normalizeOptionalGuildId(message.guildId);
      const attackerGuildId = normalizeOptionalGuildId(message.attackerGuildId);
      logCastleStatusMessage(message, ownerGuildId, attackerGuildId);
      const result = applyKoObservation(previousState, {
        castleId: message.castleId,
        defenderGuildId: ownerGuildId,
        defenderGuildName: getGuildName(message.guildId),
        attackerGuildId,
        attackerGuildName: getGuildName(message.attackerGuildId),
        defensePartyCount: message.defensePartyCount,
        attackPartyCount: message.attackPartyCount,
        koCount: message.lastWinPartyKnockOutCount,
        observedAt: receivedAt,
      });
      const unknownVictimKoDelta = result.state.unknownVictimKo - (previousState?.unknownVictimKo ?? 0);
      counters.unknownVictimKoAdds += Math.max(unknownVictimKoDelta, 0);
      logKoObserveDecision(message, previousState, result, ownerGuildId, attackerGuildId, unknownVictimKoDelta);
      castleStates.set(message.castleId, result.state);
      const notificationBattleType = toNotificationBattleType(subscriptionScope.battleType);
      if (subscriptionScope.guildId && notificationBattleType) {
        observeNotificationSafely(notificationCoordinator, {
          guildId: subscriptionScope.guildId,
          battleType: notificationBattleType,
          castleId: message.castleId,
          baseName: createFallbackBaseName(message.castleId),
          attackerGuildId,
          attackerGuildName: getGuildName(message.attackerGuildId),
          defenseCount: message.defensePartyCount,
          attackCount: message.attackPartyCount,
          observedAt: receivedAt,
          worldId: subscriptionScope.worldId,
          ...(subscriptionScope.blockId === null ? {} : { blockId: subscriptionScope.blockId }),
          runId: config.runId,
        });
      }

      if (result.shouldPersistCastle) {
        await persistCastleKoDetail(firestore, createKoCastlePublicSnapshot(result.state));
        counters.castleKoDetailsWriteCount += 1;
      }

      if (result.shouldUpdateGuildTotals) {
        guildTotalsDirty = true;
      }
    }
  }

  async function writeCurrentGuildTotals(updatedAt: Date): Promise<void> {
    const totals = calculateGuildKoTotals(castleStates.values());
    const writeInput = new Map(
      [...totals].map(([guildId, total]) => [
        guildId,
        {
          ...total,
          updatedAt,
        },
      ]),
    );
    logger.info(
      `guildKoTotals saving count=${writeInput.size} guildIds=${[...writeInput.keys()].join(",")}`,
    );
    await persistGuildKoTotals(firestore, writeInput);
    counters.guildKoTotalsUpdateCount += writeInput.size;
    guildTotalsDirty = false;
  }

  async function writeInitialGrandBattleGuildTotals(
    scope: Extract<BattleSubscriptionScope, { subscriptionType: "grandBattle" }>,
    updatedAt: Date,
  ): Promise<number> {
    const writeInput = new Map(
      scope.participantGuilds.map((guild) => [
        guild.guildId,
        {
          guildName: guild.guildName,
          totalVictimKoCount: 0,
          updatedAt,
          sourceUpdatedAt: updatedAt,
        },
      ]),
    );
    await persistGuildKoTotals(firestore, writeInput);
    return writeInput.size;
  }

  function getGuildName(rawGuildId: string | null): string | null {
    if (!rawGuildId) {
      return null;
    }

    return guildNames.get(resolveRealtimeGuildId(rawGuildId)) ?? null;
  }

  function normalizeOptionalGuildId(guildId: string | null): string | null {
    return guildId ? resolveRealtimeGuildId(guildId) : null;
  }

  function seedParticipantGuildNames(scope: BattleSubscriptionScope): void {
    if (scope.subscriptionType !== "grandBattle") {
      return;
    }

    for (const guild of scope.participantGuilds) {
      guildNames.set(guild.guildId, guild.guildName);
    }
  }

  function logReceivedPayload(payload: RealtimePayloadBytes, receivedCount: number): void {
    if (!shouldLogDebugSample(debugLogState.messageReceivedCount)) return;
    debugLogState.messageReceivedCount += 1;
    const bytes = toUint8Array(payload);
    logger.debug(
      `websocket message received count=${receivedCount} byteLength=${bytes.byteLength} ` +
        `headHex=${toHex(bytes.slice(0, DEBUG_HEX_DUMP_BYTES))}`,
    );
  }

  function logParsedPayload(total: number, guildInfo: number, castleStatus: number, unknown: number): void {
    if (!shouldLogDebugSample(debugLogState.parsedPayloadCount)) return;
    debugLogState.parsedPayloadCount += 1;
    logger.debug(
      `websocket parsed messages total=${total} guildInfo=${guildInfo} ` +
        `castleStatus=${castleStatus} unknown=${unknown}`,
    );
  }

  function logCastleStatusMessage(
    message: RawCastleStatusMessage,
    ownerGuildId: string | null,
    attackerGuildId: string | null,
  ): void {
    if (!shouldLogDebugSample(debugLogState.castleStatusCount)) return;
    debugLogState.castleStatusCount += 1;
    logger.debug(
      `castle status castleId=${message.castleId} ownerRaw=${message.guildId ?? ""} ` +
        `ownerNormalized=${ownerGuildId ?? ""} attackerRaw=${message.attackerGuildId ?? ""} ` +
        `attackerNormalized=${attackerGuildId ?? ""} defenseCount=${message.defensePartyCount} ` +
        `attackCount=${message.attackPartyCount} state=${message.gvgCastleState} ` +
        `koCount=${message.lastWinPartyKnockOutCount}`,
    );
  }

  function logKoObserveDecision(
    message: RawCastleStatusMessage,
    previousState: KoCastleState | undefined,
    result: ReturnType<typeof applyKoObservation>,
    ownerGuildId: string | null,
    attackerGuildId: string | null,
    unknownVictimKoDelta: number,
  ): void {
    if (!shouldLogDebugSample(debugLogState.decisionCount)) return;
    debugLogState.decisionCount += 1;
    const targetGuildId = subscriptionScope.guildId;
    const koDelta =
      previousState?.lastKoCount === null || previousState?.lastKoCount === undefined
        ? null
        : message.lastWinPartyKnockOutCount - previousState.lastKoCount;
    const defenseVictimDelta =
      result.state.defenseVictimKoTotal - (previousState?.defenseVictimKoTotal ?? 0);
    const attackVictimDelta =
      result.state.attackVictimKoTotal - (previousState?.attackVictimKoTotal ?? 0);
    const victim = determineVictim(defenseVictimDelta, attackVictimDelta, unknownVictimKoDelta);
    const reason = determineDecisionReason(koDelta, result, unknownVictimKoDelta);
    logger.debug(
      `ko observe decision castleId=${message.castleId} targetGuildId=${targetGuildId ?? ""} ` +
        `ownerGuildId=${ownerGuildId ?? ""} attackerGuildId=${attackerGuildId ?? ""} ` +
        `isTargetDefense=${targetGuildId !== null && ownerGuildId === targetGuildId} ` +
        `isTargetAttack=${targetGuildId !== null && attackerGuildId === targetGuildId} ` +
        `koDelta=${koDelta ?? ""} victim=${victim} shouldPersistCastle=${result.shouldPersistCastle} ` +
        `shouldUpdateGuildTotals=${result.shouldUpdateGuildTotals} reason=${reason}`,
    );
  }
}

function observeNotificationSafely(
  notificationCoordinator: NotificationCoordinator,
  observation: NotificationObservation,
): void {
  try {
    notificationCoordinator.observe(observation);
  } catch (error) {
    logger.warn(`notification observe failed in loop: ${formatErrorMessage(error)}`);
  }
}

async function flushNotificationCoordinatorSafely(
  notificationCoordinator: NotificationCoordinator,
): Promise<void> {
  try {
    const result = await notificationCoordinator.flush({
      timeoutMs: NOTIFICATION_FLUSH_TIMEOUT_MILLISECONDS,
    });
    if (hasNotificationFlushActivity(result)) {
      logger.info(
        `notification flush completed timedOut=${result.timedOut} pending=${result.pendingCount} ` +
          `created=${result.createdCount} duplicate=${result.duplicateCount} dryRun=${result.dryRunCount} ` +
          `skipped=${result.skippedCount} failed=${result.failedCount}`,
      );
    }
  } catch (error) {
    logger.warn(`notification flush failed in loop: ${formatErrorMessage(error)}`);
  }
}

function hasNotificationFlushActivity(result: Awaited<ReturnType<NotificationCoordinator["flush"]>>): boolean {
  return (
    result.timedOut ||
    result.pendingCount > 0 ||
    result.createdCount > 0 ||
    result.duplicateCount > 0 ||
    result.dryRunCount > 0 ||
    result.skippedCount > 0 ||
    result.failedCount > 0
  );
}

type ResolvedMonitorTarget =
  | {
      status: "ok";
      source: "env" | "guildShares";
      worldId: string;
      guildId: string | null;
      guildName: string | null;
    }
  | {
      status: "empty" | "multiple";
      message: string;
    };

async function resolveMonitorTarget(
  config: AppConfig,
  firestore: Firestore,
  loadMonitorGuildTarget: typeof loadMonitorGuildTargetFromGuildShares,
): Promise<ResolvedMonitorTarget> {
  if (config.worldId) {
    return {
      status: "ok",
      source: "env",
      worldId: config.worldId,
      guildId: config.guildId ?? null,
      guildName: config.ownGuildName ?? null,
    };
  }

  const guildShareTarget = await loadMonitorGuildTarget(firestore);
  if (guildShareTarget.status !== "ok") {
    return guildShareTarget;
  }

  return {
    status: "ok",
    source: "guildShares",
    worldId: guildShareTarget.worldId,
    guildId: guildShareTarget.guildId,
    guildName: guildShareTarget.guildName,
  };
}

function createSubscriptionPayload(subscriptionScope: BattleSubscriptionScope): Uint8Array {
  if (subscriptionScope.subscriptionType === "guildBattle") {
    return createGuildBattleSubscriptionPayload(subscriptionScope.worldId);
  }

  if (subscriptionScope.subscriptionType === "grandBattle") {
    return createGrandBattleSubscriptionPayload({
      worldGroupId: subscriptionScope.worldGroupId,
      classId: subscriptionScope.classId,
      blockId: subscriptionScope.blockId,
    });
  }

  throw new Error("Cannot create subscription payload for unresolved battle scope.");
}

function logSubscriptionPayload(subscriptionScope: BattleSubscriptionScope, payload: Uint8Array): void {
  const streamId = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, true);
  const decodedStreamId = decodeGvgStreamId(streamId);
  logger.debug(
    `websocket subscription payload battleType=${subscriptionScope.battleType} ` +
      `subscriptionType=${subscriptionScope.subscriptionType} worldId=${subscriptionScope.worldId} ` +
      `castleId=${decodedStreamId.castleId} blockId=${decodedStreamId.block} ` +
      `worldGroupId=${decodedStreamId.worldGroupId} classId=${decodedStreamId.gvgClass} ` +
      `streamId=${streamId} streamIdHex=0x${streamId.toString(16).padStart(8, "0")} ` +
      `payloadHex=${toHex(payload)}`,
  );
}

function createScopeLogMessage(prefix: string, subscriptionScope: BattleSubscriptionScope): string {
  return [
    prefix,
    `battleType=${subscriptionScope.battleType}`,
    `worldId=${subscriptionScope.worldId}`,
    `guildId=${subscriptionScope.guildId ?? ""}`,
    `worldGroupId=${subscriptionScope.worldGroupId ?? ""}`,
    `classId=${subscriptionScope.classId ?? ""}`,
    `blockId=${subscriptionScope.blockId ?? ""}`,
    `subscriptionType=${subscriptionScope.subscriptionType}`,
  ].join(" ");
}

function logSummary(
  subscriptionScope: BattleSubscriptionScope,
  counters: {
    websocketOpened: boolean;
    subscriptionSent: boolean;
    websocketMessageReceivedCount: number;
    guildMessageCount: number;
    parsedCastleStatusCount: number;
    parseErrorCount: number;
    castleKoDetailsWriteCount: number;
    guildKoTotalsUpdateCount: number;
    parsedMessageCount: number;
    unknownMessageCount: number;
    unknownVictimKoAdds: number;
  },
  durationSeconds: number,
): void {
  logger.info(
    `Phase5 KO observe summary battleType=${subscriptionScope.battleType} ` +
      `worldId=${subscriptionScope.worldId} guildId=${subscriptionScope.guildId ?? ""} ` +
      `worldGroupId=${subscriptionScope.worldGroupId ?? ""} classId=${subscriptionScope.classId ?? ""} ` +
      `blockId=${subscriptionScope.blockId ?? ""} subscriptionType=${subscriptionScope.subscriptionType} ` +
      `websocketOpened=${counters.websocketOpened} subscriptionSent=${counters.subscriptionSent} ` +
      `messagesReceived=${counters.websocketMessageReceivedCount} parsedMessages=${counters.parsedMessageCount} ` +
      `guildInfoMessages=${counters.guildMessageCount} castleStatusMessages=${counters.parsedCastleStatusCount} ` +
      `parseErrors=${counters.parseErrorCount} unknownMessages=${counters.unknownMessageCount} ` +
      `castlePersistWrites=${counters.castleKoDetailsWriteCount} guildTotalWrites=${counters.guildKoTotalsUpdateCount} ` +
      `unknownVictimKoAdds=${counters.unknownVictimKoAdds} durationSeconds=${durationSeconds}`,
  );
}

function shouldLogDebugSample(currentCount: number): boolean {
  return currentCount < DEBUG_LOG_SAMPLE_LIMIT;
}

function toUint8Array(payload: RealtimePayloadBytes): Uint8Array {
  return payload instanceof Uint8Array ? payload : new Uint8Array(payload);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function determineVictim(defenseVictimDelta: number, attackVictimDelta: number, unknownVictimDelta: number): string {
  if (defenseVictimDelta > 0) {
    return "defense";
  }
  if (attackVictimDelta > 0) {
    return "attack";
  }
  if (unknownVictimDelta > 0) {
    return "unknown";
  }
  return "none";
}

function determineDecisionReason(
  koDelta: number | null,
  result: ReturnType<typeof applyKoObservation>,
  unknownVictimKoDelta: number,
): string {
  if (koDelta === null) {
    return "initial_observation";
  }
  if (koDelta === 0) {
    return "no_ko_delta";
  }
  if (koDelta < 0) {
    return "ko_decreased";
  }
  if (unknownVictimKoDelta > 0) {
    return "unknown_victim";
  }
  if (result.shouldPersistCastle || result.shouldUpdateGuildTotals) {
    return result.reasons.length > 0 ? result.reasons.join(",") : "ko_delta";
  }
  if (result.checkpointSlot === null) {
    return "before_battle_start";
  }
  return "not_persist_condition";
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}

function toNotificationBattleType(
  battleType: BattleSubscriptionScope["battleType"],
): NotificationBattleType | null {
  return battleType === "guildBattle" || battleType === "grandBattle" ? battleType : null;
}

function normalizeGuildId(guildId: string, worldId: string): string {
  const rawGuildId = guildId.trim();
  const numericWorldId = Number(worldId);
  if (rawGuildId.length >= 12 || !Number.isInteger(numericWorldId) || numericWorldId <= 0) {
    return rawGuildId;
  }

  return `${rawGuildId}${String(numericWorldId % 1000).padStart(3, "0")}`;
}

function createRealtimeGuildIdResolver(
  subscriptionScope: BattleSubscriptionScope,
): (guildId: string) => string {
  if (subscriptionScope.subscriptionType !== "grandBattle") {
    return (guildId) => normalizeGuildId(guildId, subscriptionScope.worldId);
  }

  const fullGuildIdByRealtimeGuildId = new Map<string, string>();
  for (const participantGuild of subscriptionScope.participantGuilds) {
    fullGuildIdByRealtimeGuildId.set(participantGuild.guildId, participantGuild.guildId);
    fullGuildIdByRealtimeGuildId.set(
      stripWorldSuffix(participantGuild.guildId),
      participantGuild.guildId,
    );
  }

  return (guildId) => {
    const rawGuildId = guildId.trim();
    return fullGuildIdByRealtimeGuildId.get(rawGuildId) ?? rawGuildId;
  };
}

function stripWorldSuffix(guildId: string): string {
  return guildId.length > 3 ? guildId.slice(0, -3) : guildId;
}

function sleepMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
