import assert from "node:assert/strict";
import test from "node:test";
import { calculateCastleObservationDiffs } from "./castleObservationDiff.js";
import type { CastleObservationMap } from "./castleObservationDiff.js";

test("detects count increase without treating it as reset", () => {
  const [diff] = calculateCastleObservationDiffs(
    createObservationMap({ castleId: 1, count: 2 }),
    createObservationMap({ castleId: 1, count: 5 }),
  );

  assert.equal(diff?.previousCount, 2);
  assert.equal(diff?.currentCount, 5);
  assert.equal(diff?.countDelta, 3);
  assert.equal(diff?.isCountIncreased, true);
  assert.equal(diff?.isCountReset, false);
});

test("detects count reset", () => {
  const [diff] = calculateCastleObservationDiffs(
    createObservationMap({ castleId: 1, count: 5 }),
    createObservationMap({ castleId: 1, count: 2 }),
  );

  assert.equal(diff?.countDelta, -3);
  assert.equal(diff?.isCountReset, true);
});

test("detects state defender and attacker changes", () => {
  const [diff] = calculateCastleObservationDiffs(
    createObservationMap({
      castleId: 1,
      gvgCastleState: 1,
      defenderGuildId: 100,
      attackerGuildId: 200,
    }),
    createObservationMap({
      castleId: 1,
      gvgCastleState: 2,
      defenderGuildId: 101,
      attackerGuildId: 201,
    }),
  );

  assert.equal(diff?.isStateChanged, true);
  assert.equal(diff?.isDefenderChanged, true);
  assert.equal(diff?.isAttackerChanged, true);
});

test("compares previous-only castle against current default values", () => {
  const [diff] = calculateCastleObservationDiffs(
    createObservationMap({
      castleId: 1,
      count: 4,
      gvgCastleState: 1,
      defenderGuildId: 100,
      attackerGuildId: 200,
    }),
    {},
  );

  assert.equal(diff?.castleId, 1);
  assert.equal(diff?.currentCount, 0);
  assert.equal(diff?.isCountReset, true);
  assert.equal(diff?.isStateChanged, true);
  assert.equal(diff?.isDefenderChanged, true);
  assert.equal(diff?.isAttackerChanged, true);
});

test("compares current-only castle against previous default values", () => {
  const [diff] = calculateCastleObservationDiffs(
    {},
    createObservationMap({
      castleId: 1,
      count: 4,
      gvgCastleState: 1,
      defenderGuildId: 100,
      attackerGuildId: 200,
    }),
  );

  assert.equal(diff?.castleId, 1);
  assert.equal(diff?.previousCount, 0);
  assert.equal(diff?.isCountIncreased, true);
  assert.equal(diff?.isStateChanged, true);
  assert.equal(diff?.isDefenderChanged, true);
  assert.equal(diff?.isAttackerChanged, true);
});

function createObservationMap(observation: {
  castleId: number;
  count?: number;
  gvgCastleState?: number;
  defenderGuildId?: number;
  attackerGuildId?: number;
}): CastleObservationMap {
  return {
    [observation.castleId.toString()]: {
      castleId: observation.castleId,
      count: observation.count ?? 0,
      gvgCastleState: observation.gvgCastleState ?? 0,
      defenderGuildId: observation.defenderGuildId ?? 0,
      attackerGuildId: observation.attackerGuildId ?? 0,
    },
  };
}
