import type { Firestore } from "firebase-admin/firestore";
import type { AppConfig } from "./config.js";
import {
  initializePhase5KoObserverRun,
  writeCastleKoDetail,
  writeGuildKoTotals,
} from "../firestore/koObserverKoRepository.js";
import { GvgRealtimeClient } from "../mentemori/realtimeClient.js";
import {
  parseRealtimePayload,
  type RealtimePayloadBytes,
} from "../mentemori/realtimeParser.js";
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
  if (!config.worldId) {
    throw new Error("KOO_WORLD_ID is required for phase5-ko-observe-loop.");
  }

  const worldId = config.worldId;
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? sleepMilliseconds;
  const initializeRun =
    dependencies.initializePhase5KoObserverRun ?? initializePhase5KoObserverRun;
  const persistCastleKoDetail = dependencies.writeCastleKoDetail ?? writeCastleKoDetail;
  const persistGuildKoTotals = dependencies.writeGuildKoTotals ?? writeGuildKoTotals;
  const realtimeClient = (dependencies.createRealtimeClient ?? (() => new GvgRealtimeClient()))();
  const guildNames = new Map<string, string>();
  const castleStates = new Map<number, KoCastleState>();
  const startedAt = now();
  const endAtMilliseconds = startedAt.getTime() + config.observeDurationSeconds * 1000;
  let nextGuildTotalUpdateAt = startedAt.getTime() + GUILD_TOTAL_UPDATE_INTERVAL_MILLISECONDS;
  let guildTotalsDirty = false;
  let payloadProcessing: Promise<void> = Promise.resolve();

  await initializeRun(firestore, startedAt);

  realtimeClient.addEventListener((event) => {
    if (event.type === "payloadReceived") {
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
  await realtimeClient.connect(worldId);

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

  logger.info("Phase5 KO observe loop completed.");

  async function handlePayload(payload: RealtimePayloadBytes, receivedAt: Date): Promise<void> {
    const parserResult = parseRealtimePayload(payload);
    if (parserResult.status === "error") {
      logger.warn(`Phase5 realtime parser error: ${parserResult.error.message}`);
    }

    for (const message of parserResult.messages) {
      if (message.type === "guild" && message.guildId && message.guildName) {
        guildNames.set(normalizeGuildId(message.guildId, worldId), message.guildName);
      }

      if (message.type !== "castleStatus") {
        continue;
      }

      const result = applyKoObservation(castleStates.get(message.castleId), {
        castleId: message.castleId,
        defenderGuildId: normalizeOptionalGuildId(message.guildId, worldId),
        defenderGuildName: getGuildName(message.guildId),
        attackerGuildId: normalizeOptionalGuildId(message.attackerGuildId, worldId),
        attackerGuildName: getGuildName(message.attackerGuildId),
        defensePartyCount: message.defensePartyCount,
        attackPartyCount: message.attackPartyCount,
        koCount: message.lastWinPartyKnockOutCount,
        observedAt: receivedAt,
      });
      castleStates.set(message.castleId, result.state);

      if (result.shouldPersistCastle) {
        await persistCastleKoDetail(firestore, createKoCastlePublicSnapshot(result.state));
        logger.info(
          `Phase5 castle saved castleId=${message.castleId} reasons=${JSON.stringify(
            result.reasons,
          )}`,
        );
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
    await persistGuildKoTotals(firestore, writeInput);
    guildTotalsDirty = false;
    logger.info(`Phase5 guild totals saved count=${writeInput.size}`);
  }

  function getGuildName(rawGuildId: string | null): string | null {
    if (!rawGuildId) {
      return null;
    }

    return guildNames.get(normalizeGuildId(rawGuildId, worldId)) ?? null;
  }
}

function normalizeOptionalGuildId(guildId: string | null, worldId: string): string | null {
  return guildId ? normalizeGuildId(guildId, worldId) : null;
}

function normalizeGuildId(guildId: string, worldId: string): string {
  const rawGuildId = guildId.trim();
  const numericWorldId = Number(worldId);
  if (rawGuildId.length >= 12 || !Number.isInteger(numericWorldId) || numericWorldId <= 0) {
    return rawGuildId;
  }

  return `${rawGuildId}${String(numericWorldId % 1000).padStart(3, "0")}`;
}

function sleepMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
