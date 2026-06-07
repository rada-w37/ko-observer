import type { Firestore } from "firebase-admin/firestore";
import type { AppConfig } from "./config.js";
import { getJstDateString } from "./date.js";
import { writePhase1ScopeTestView } from "../firestore/koObserverViewRepository.js";
import { fetchLatestLocalGvg } from "../mentemori/apiClient.js";
import type { LocalGvgLatest } from "../mentemori/types.js";
import { extractActiveGuilds } from "../koo/activeGuildExtractor.js";
import { resolveBattleStatus } from "../koo/battleStatusResolver.js";
import { logger } from "../shared/logger.js";

type RunPhase1ScopeTestDependencies = {
  fetchLatestLocalGvg?: (worldId: string) => Promise<LocalGvgLatest>;
  writePhase1ScopeTestView?: typeof writePhase1ScopeTestView;
};

export async function runPhase1ScopeTest(
  config: AppConfig,
  firestore: Firestore,
  dependencies: RunPhase1ScopeTestDependencies = {},
): Promise<void> {
  if (!config.worldId) {
    throw new Error("KOO_WORLD_ID is required for phase1-scope-test.");
  }

  const latestLocalGvg = await (dependencies.fetchLatestLocalGvg ?? fetchLatestLocalGvg)(
    config.worldId,
  );
  const battleStatus = resolveBattleStatus(latestLocalGvg.castles, config.worldId);
  const activeGuilds = extractActiveGuilds(latestLocalGvg.castles);

  if (battleStatus.unknownGvgCastleStates.length > 0) {
    logger.warn(
      `Unknown GvgCastleState values: ${battleStatus.unknownGvgCastleStates.join(", ")}`,
    );
  }

  await (dependencies.writePhase1ScopeTestView ?? writePhase1ScopeTestView)(firestore, {
    battleDate: getJstDateString(new Date()),
    mode: config.mode,
    runId: config.runId,
    worldId: config.worldId,
    battleStatus,
    activeGuilds,
    localGvgCastleCount: latestLocalGvg.castles.length,
  });
}
