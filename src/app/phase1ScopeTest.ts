import type { Firestore } from "firebase-admin/firestore";
import type { AppConfig } from "./config.js";
import { getJstDateString } from "./date.js";
import {
  readPhase1ScopeTestView,
  writePhase1ScopeTestView,
} from "../firestore/koObserverViewRepository.js";
import { fetchLatestLocalGvg } from "../mentemori/apiClient.js";
import type { LocalGvgLatest } from "../mentemori/types.js";
import { attachObservationDiffs, extractActiveGuilds } from "../koo/activeGuildExtractor.js";
import { resolveBattleStatus } from "../koo/battleStatusResolver.js";
import {
  calculateCastleObservationDiffs,
  createCastleObservationMapFromActiveGuilds,
  createCastleObservationMapFromLocalGvg,
} from "../koo/castleObservationDiff.js";
import {
  CHECKPOINT_SECONDS,
  decidePersist,
  isCheckpointElapsed,
} from "../koo/persistDecision.js";
import { logger } from "../shared/logger.js";

type RunPhase1ScopeTestDependencies = {
  fetchLatestLocalGvg?: (worldId: string) => Promise<LocalGvgLatest>;
  readPhase1ScopeTestView?: typeof readPhase1ScopeTestView;
  writePhase1ScopeTestView?: typeof writePhase1ScopeTestView;
  now?: () => Date;
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
  const previousView = await (dependencies.readPhase1ScopeTestView ?? readPhase1ScopeTestView)(
    firestore,
  );
  const battleStatus = resolveBattleStatus(latestLocalGvg.castles, config.worldId);
  const activeGuilds = extractActiveGuilds(latestLocalGvg);
  const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const previousObservedAt = previousView?.phase3?.observedAt ?? previousView?.updatedAt;
  const previousObservationMap = previousView
    ? createCastleObservationMapFromActiveGuilds(previousView.activeGuilds)
    : {};
  const currentObservationMap = createCastleObservationMapFromLocalGvg(latestLocalGvg);
  const observationDiffs = calculateCastleObservationDiffs(
    previousObservationMap,
    currentObservationMap,
  );
  const persistDecision = decidePersist(
    previousView ? observationDiffs : [],
    isCheckpointElapsed(previousObservedAt, observedAt, CHECKPOINT_SECONDS),
  );
  const activeGuildsWithDiffs = attachObservationDiffs(activeGuilds, observationDiffs);

  if (battleStatus.unknownGvgCastleStates.length > 0) {
    logger.warn(
      `Unknown GvgCastleState values: ${battleStatus.unknownGvgCastleStates.join(", ")}`,
    );
  }

  if (!persistDecision.shouldPersist) {
    logger.info("KOO Phase1 scope test skipped Firestore write. shouldPersist=false");
    return;
  }

  await (dependencies.writePhase1ScopeTestView ?? writePhase1ScopeTestView)(firestore, {
    battleDate: getJstDateString(new Date()),
    mode: config.mode,
    runId: config.runId,
    worldId: config.worldId,
    battleStatus,
    activeGuilds: activeGuildsWithDiffs,
    localGvgCastleCount: latestLocalGvg.castles.length,
    phase3: {
      observedAt,
      shouldPersist: persistDecision.shouldPersist,
      persistReasons: persistDecision.reasons,
      checkpointSeconds: CHECKPOINT_SECONDS,
    },
  });
}
