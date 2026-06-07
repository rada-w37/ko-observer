import type { CastleObservationDiff } from "./castleObservationDiff.js";

export const CHECKPOINT_SECONDS = 30;

export type PersistReason =
  | "count_reset"
  | "state_changed"
  | "defender_changed"
  | "attacker_changed"
  | "checkpoint_elapsed";

export type PersistDecision = {
  shouldPersist: boolean;
  reasons: PersistReason[];
};

export function decidePersist(
  castleObservationDiffs: CastleObservationDiff[],
  checkpointElapsed: boolean,
): PersistDecision {
  const reasons = new Set<PersistReason>();

  for (const castleObservationDiff of castleObservationDiffs) {
    if (castleObservationDiff.isCountReset) {
      reasons.add("count_reset");
    }
    if (castleObservationDiff.isStateChanged) {
      reasons.add("state_changed");
    }
    if (castleObservationDiff.isDefenderChanged) {
      reasons.add("defender_changed");
    }
    if (castleObservationDiff.isAttackerChanged) {
      reasons.add("attacker_changed");
    }
  }

  if (checkpointElapsed) {
    reasons.add("checkpoint_elapsed");
  }

  return {
    shouldPersist: reasons.size > 0,
    reasons: [...reasons],
  };
}

export function isCheckpointElapsed(
  previousObservedAtIsoString: string | undefined,
  currentObservedAtIsoString: string,
  checkpointSeconds: number = CHECKPOINT_SECONDS,
): boolean {
  if (!previousObservedAtIsoString) {
    return true;
  }

  const previousObservedAtTime = Date.parse(previousObservedAtIsoString);
  const currentObservedAtTime = Date.parse(currentObservedAtIsoString);

  if (Number.isNaN(previousObservedAtTime) || Number.isNaN(currentObservedAtTime)) {
    return true;
  }

  return currentObservedAtTime - previousObservedAtTime >= checkpointSeconds * 1000;
}
