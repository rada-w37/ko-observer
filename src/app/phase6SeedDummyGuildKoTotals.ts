import type { Firestore } from "firebase-admin/firestore";
import type { AppConfig } from "./config.js";
import { ObservationRunRepository } from "../firestore/observationRunRepository.js";
import { fetchLatestLocalGvg } from "../mentemori/apiClient.js";
import type { LocalGvgLatest } from "../mentemori/types.js";
import { observationPolicy, withinDeadline } from "./observationPolicy.js";
import { logger } from "../shared/logger.js";

export type Phase6SeedDummyGuildKoTotalsResult = {
  fetchedGuildCount: number; selectedGuildCount: number; clearedGuildKoTotalsCount: number; writtenGuildKoTotalsCount: number;
};
type SeedStore = Pick<ObservationRunRepository, "acquire" | "seed" | "release">;
type Dependencies = { fetchLatestLocalGvg?: (worldId: string) => Promise<LocalGvgLatest>; createStore?: () => SeedStore; now?: () => Date };
const DUMMY_KO_COUNTS = [12, 7, 3, 0, 5] as const;

export async function runPhase6SeedDummyGuildKoTotals(config: AppConfig, firestore: Firestore, dependencies: Dependencies = {}): Promise<Phase6SeedDummyGuildKoTotalsResult> {
  if (!config.worldId) throw new Error("KOO_WORLD_ID is required for phase6-seed-dummy-guild-ko-totals.");
  const fetched = await withinDeadline((dependencies.fetchLatestLocalGvg ?? ((worldId) => fetchLatestLocalGvg(worldId,
    (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(observationPolicy.connectTimeoutMs) }))))(config.worldId),
    observationPolicy.connectTimeoutMs, "Fetch dummy seed input");
  const updatedAt = (dependencies.now ?? (() => new Date()))();
  const guildIds = new Set(fetched.castles.flatMap((castle) => [castle.GuildId, castle.AttackerGuildId]).filter((guildId) => guildId !== 0).map(String));
  const selected = [...guildIds].filter((guildId) => fetched.guilds[guildId]).sort((a, b) => Number(a) - Number(b)).slice(0, DUMMY_KO_COUNTS.length);
  const totals = new Map(selected.map((guildId, index) => [guildId, { guildName: fetched.guilds[guildId], totalVictimKoCount: DUMMY_KO_COUNTS[index], updatedAt }]));
  const store = (dependencies.createStore ?? (() => new ObservationRunRepository(firestore)))();
  const lease = await withinDeadline(store.acquire(), observationPolicy.operationTimeoutMs, "Acquire seed ownership");
  let clearedGuildKoTotalsCount: number;
  try { clearedGuildKoTotalsCount = await withinDeadline(store.seed(lease, totals, config.seedClear, updatedAt), observationPolicy.operationTimeoutMs, "Seed public totals"); }
  finally { await withinDeadline(store.release(lease), observationPolicy.shutdownTimeoutMs, "Release seed ownership"); }
  const result = { fetchedGuildCount: Object.keys(fetched.guilds).length, selectedGuildCount: selected.length, clearedGuildKoTotalsCount, writtenGuildKoTotalsCount: totals.size };
  logger.info(`Phase6 dummy seed completed ${JSON.stringify(result)}`);
  return result;
}
