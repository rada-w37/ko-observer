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
import { GvgRealtimeClient } from "../mentemori/realtimeClient.js";
import {
  parseRealtimePayload,
  type RealtimePayloadBytes,
} from "../mentemori/realtimeParser.js";
import {
  createGrandBattleSubscriptionPayload,
  createGuildBattleSubscriptionPayload,
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
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
};

const GUILD_TOTAL_UPDATE_INTERVAL_MILLISECONDS = 5000;
const LOOP_SLEEP_MILLISECONDS = 250;

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
    parsedCastleStatusCount: 0,
    parseErrorCount: 0,
    castleKoDetailsWriteCount: 0,
    guildKoTotalsUpdateCount: 0,
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
    logSummary(subscriptionScope, counters);
    logger.info("Phase5 KO observe loop completed.");
    return;
  }

  const resolveRealtimeGuildId = createRealtimeGuildIdResolver(subscriptionScope);
  seedParticipantGuildNames(subscriptionScope);
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
  }

  logSummary(subscriptionScope, counters);
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
    counters.guildMessageCount += guildMessages.length;
    counters.parsedCastleStatusCount += castleStatusMessages.length;

    for (const message of parserResult.messages) {
      if (message.type === "guild" && message.guildId && message.guildName) {
        guildNames.set(resolveRealtimeGuildId(message.guildId), message.guildName);
      }

      if (message.type !== "castleStatus") {
        continue;
      }

      const result = applyKoObservation(castleStates.get(message.castleId), {
        castleId: message.castleId,
        defenderGuildId: normalizeOptionalGuildId(message.guildId),
        defenderGuildName: getGuildName(message.guildId),
        attackerGuildId: normalizeOptionalGuildId(message.attackerGuildId),
        attackerGuildName: getGuildName(message.attackerGuildId),
        defensePartyCount: message.defensePartyCount,
        attackPartyCount: message.attackPartyCount,
        koCount: message.lastWinPartyKnockOutCount,
        observedAt: receivedAt,
      });
      castleStates.set(message.castleId, result.state);

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
  },
): void {
  logger.info(
    [
      "Phase5 summary",
      `battleType=${subscriptionScope.battleType}`,
      `worldId=${subscriptionScope.worldId}`,
      `guildId=${subscriptionScope.guildId ?? ""}`,
      `worldGroupId=${subscriptionScope.worldGroupId ?? ""}`,
      `classId=${subscriptionScope.classId ?? ""}`,
      `blockId=${subscriptionScope.blockId ?? ""}`,
      `subscriptionType=${subscriptionScope.subscriptionType}`,
      `websocketOpened=${counters.websocketOpened}`,
      `subscriptionSent=${counters.subscriptionSent}`,
      `messagesReceived=${counters.websocketMessageReceivedCount}`,
      `castleStatusMessages=${counters.parsedCastleStatusCount}`,
      `guildMessages=${counters.guildMessageCount}`,
      `parseErrors=${counters.parseErrorCount}`,
      `castleWrites=${counters.castleKoDetailsWriteCount}`,
      `guildTotalWrites=${counters.guildKoTotalsUpdateCount}`,
    ].join(" "),
  );
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
