import assert from "node:assert/strict";
import test from "node:test";
import { KoAccumulator } from "./koAccumulator.js";
import {
  applyKoObservation,
  calculateGuildKoTotals,
  type KoCastleObservation,
  type KoCastleState,
} from "./koAttribution.js";

function observation(overrides: Partial<KoCastleObservation> = {}): KoCastleObservation {
  return {
    castleId: 1,
    defenderGuildId: "111111111037",
    defenderGuildName: "Defender",
    attackerGuildId: "222222222037",
    attackerGuildName: "Attacker",
    defensePartyCount: 100,
    attackPartyCount: 100,
    koCount: 0,
    observedAt: new Date("2026-11-02T11:45:01Z"),
    ...overrides,
  };
}

test("matches uninterrupted attribution, checkpoints, owner changes and guild totals", () => {
  const accumulator = new KoAccumulator();
  const referenceStates = new Map<number, KoCastleState>();
  const observations = [
    observation({ observedAt: new Date("2026-11-02T11:44:59Z") }),
    observation(),
    observation({ koCount: 7, defensePartyCount: 93 }),
    observation({ koCount: 8, defensePartyCount: 93, attackPartyCount: 99 }),
    observation({ koCount: 9, defensePartyCount: 93, attackPartyCount: 99 }),
    observation({ koCount: 2, defensePartyCount: 93, attackPartyCount: 99 }),
    observation({ koCount: 3, defensePartyCount: 92, attackPartyCount: 99 }),
    observation({ koCount: 3, defensePartyCount: 92, attackPartyCount: 99,
      observedAt: new Date("2026-11-02T11:45:31Z") }),
    observation({ defenderGuildId: "333333333037", koCount: 3 }),
    observation({ defenderGuildId: "333333333037", koCount: 4, defensePartyCount: 99 }),
    observation({ castleId: 2 }),
    observation({ castleId: 2, koCount: 5, attackPartyCount: 95 }),
  ];
  for (const [index, input] of observations.entries()) {
    const expected = applyKoObservation(referenceStates.get(input.castleId), input);
    referenceStates.set(input.castleId, expected.state);
    assert.deepEqual(accumulator.observe(input), { ...expected, revision: index + 1, rebased: false });
  }
  assert.deepEqual(accumulator.getGuildTotals(), calculateGuildKoTotals(referenceStates.values()));
  assert.equal(accumulator.getGuildTotals().get("111111111037")?.totalVictimKoCount, 10);
  assert.equal(accumulator.getGuildTotals().get("222222222037")?.totalVictimKoCount, 6);
  assert.equal(accumulator.getGuildTotals().get("333333333037")?.totalVictimKoCount, 1);
});

test("reconnect rebases each castle independently without adding missing KO", () => {
  const accumulator = new KoAccumulator();
  accumulator.observe(observation());
  accumulator.observe(observation({ koCount: 7, defensePartyCount: 93 }));
  accumulator.observe(observation({ castleId: 2 }));
  accumulator.observe(observation({ castleId: 2, koCount: 2, attackPartyCount: 98 }));
  accumulator.beginObservationEpoch();
  accumulator.beginObservationEpoch();
  const first = accumulator.observe(observation({ koCount: 50, defensePartyCount: 50 }));
  assert.equal(first.rebased, true);
  assert.equal(first.shouldUpdateGuildTotals, false);
  assert.equal(first.shouldPersistCastle, true);
  assert.equal(first.state.defenseVictimKoTotal, 7);
  accumulator.observe(observation({ koCount: 51, defensePartyCount: 49 }));
  const second = accumulator.observe(observation({ castleId: 2, koCount: 0, attackPartyCount: 50 }));
  assert.equal(second.rebased, true);
  accumulator.observe(observation({ castleId: 2, koCount: 1, attackPartyCount: 49 }));
  assert.equal(accumulator.getGuildTotals().get("111111111037")?.totalVictimKoCount, 8);
  assert.equal(accumulator.getGuildTotals().get("222222222037")?.totalVictimKoCount, 3);
});

test("reconnect does not move the previous guild's accumulated KO to the new owner", () => {
  const accumulator = new KoAccumulator();
  accumulator.observe(observation());
  accumulator.observe(observation({ koCount: 7, defensePartyCount: 93 }));
  accumulator.beginObservationEpoch();
  const baseline = accumulator.observe(observation({ defenderGuildId: "333333333037", koCount: 80 }));
  assert.equal(baseline.state.defenseVictimKoTotal, 0);
  accumulator.observe(observation({ defenderGuildId: "333333333037", koCount: 81, defensePartyCount: 99 }));
  assert.equal(accumulator.getGuildTotals().get("111111111037")?.totalVictimKoCount, 7);
  assert.equal(accumulator.getGuildTotals().get("333333333037")?.totalVictimKoCount, 1);
});

test("pending attribution is not carried across a reconnect", () => {
  const accumulator = new KoAccumulator();
  accumulator.observe(observation());
  accumulator.observe(observation({ koCount: 7, defensePartyCount: 93 }));
  accumulator.observe(observation({ koCount: 2, defensePartyCount: 93 }));
  accumulator.beginObservationEpoch();
  const baseline = accumulator.observe(observation({ koCount: 3, defensePartyCount: 92 }));
  assert.equal(baseline.state.pendingUnknownInitialKo, 0);
  assert.equal(baseline.state.pendingDefenseVictimKo, 0);
  assert.equal(baseline.state.pendingAttackVictimKo, 0);
  assert.equal(baseline.state.attributionMode, "unknown");
  assert.equal(baseline.state.unknownVictimKo, 2);
  accumulator.observe(observation({ koCount: 4, defensePartyCount: 91 }));
  assert.equal(accumulator.getGuildTotals().get("111111111037")?.totalVictimKoCount, 8);
});

test("restoring a snapshot preserves committed totals and starts with new baselines", () => {
  const original = new KoAccumulator();
  original.observe(observation());
  original.observe(observation({ koCount: 7, defensePartyCount: 93 }));
  const checkpoint = original.exportSnapshot();
  const restored = new KoAccumulator(checkpoint);
  assert.deepEqual(restored.exportSnapshot(), checkpoint);
  assert.ok(restored.exportSnapshot().castleStates[0].lastObservedAt instanceof Date);
  assert.equal(restored.observe(observation({ koCount: 2, defensePartyCount: 40 })).rebased, true);
  restored.observe(observation({ koCount: 3, defensePartyCount: 39 }));
  assert.equal(restored.exportSnapshot().revision, 4);
  assert.equal(restored.getGuildTotals().get("111111111037")?.totalVictimKoCount, 8);
});

test("caller mutations cannot modify accumulated state or an exported snapshot", () => {
  const accumulator = new KoAccumulator();
  const input = observation();
  accumulator.observe(input);
  input.observedAt.setTime(0);
  const update = accumulator.observe(observation({ koCount: 7, defensePartyCount: 93 }));
  const snapshot = accumulator.exportSnapshot();
  const restored = new KoAccumulator(snapshot);
  update.state.guildVictimKoTotals["111111111037"].totalVictimKoCount = 999;
  snapshot.castleStates[0].guildVictimKoTotals["111111111037"].totalVictimKoCount = 999;
  snapshot.castleStates[0].lastObservedAt!.setTime(0);
  accumulator.getGuildTotals().get("111111111037")!.sourceUpdatedAt.setTime(0);
  accumulator.observe(observation({ koCount: 8, defensePartyCount: 92 }));
  assert.equal(accumulator.getGuildTotals().get("111111111037")?.totalVictimKoCount, 8);
  assert.equal(restored.getGuildTotals().get("111111111037")?.totalVictimKoCount, 7);
  assert.equal(snapshot.revision, 2);
  assert.notEqual(accumulator.exportSnapshot().castleStates[0].lastObservedAt!.getTime(), 0);
});
