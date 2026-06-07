import assert from "node:assert/strict";
import test from "node:test";
import { decidePersist, isCheckpointElapsed } from "./persistDecision.js";
import type { CastleObservationDiff } from "./castleObservationDiff.js";

test("does not persist count increase only", () => {
  const decision = decidePersist([
    createDiff({
      isCountIncreased: true,
      countDelta: 3,
    }),
  ], false);

  assert.equal(decision.shouldPersist, false);
  assert.deepEqual(decision.reasons, []);
});

test("persists count reset", () => {
  const decision = decidePersist([
    createDiff({
      isCountReset: true,
      countDelta: -3,
    }),
  ], false);

  assert.equal(decision.shouldPersist, true);
  assert.deepEqual(decision.reasons, ["count_reset"]);
});

test("persists state defender and attacker changes", () => {
  const decision = decidePersist([
    createDiff({
      isStateChanged: true,
      isDefenderChanged: true,
      isAttackerChanged: true,
    }),
  ], false);

  assert.equal(decision.shouldPersist, true);
  assert.deepEqual(decision.reasons, [
    "state_changed",
    "defender_changed",
    "attacker_changed",
  ]);
});

test("persists checkpoint elapsed", () => {
  const decision = decidePersist([createDiff()], true);

  assert.equal(decision.shouldPersist, true);
  assert.deepEqual(decision.reasons, ["checkpoint_elapsed"]);
});

test("detects checkpoint elapsed by timestamp", () => {
  assert.equal(
    isCheckpointElapsed("2026-06-07T12:00:00.000Z", "2026-06-07T12:00:30.000Z"),
    true,
  );
  assert.equal(
    isCheckpointElapsed("2026-06-07T12:00:00.000Z", "2026-06-07T12:00:29.999Z"),
    false,
  );
});

function createDiff(overrides: Partial<CastleObservationDiff> = {}): CastleObservationDiff {
  return {
    castleId: 1,
    previousCount: 0,
    currentCount: 0,
    countDelta: 0,
    isCountIncreased: false,
    isCountReset: false,
    isStateChanged: false,
    isDefenderChanged: false,
    isAttackerChanged: false,
    ...overrides,
  };
}
