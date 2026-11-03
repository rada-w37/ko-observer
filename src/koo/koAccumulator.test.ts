import assert from "node:assert/strict";
import test from "node:test";
import { KoAccumulator } from "./koAccumulator.js";
import type { KoCastleObservation } from "./koAttribution.js";
function frame(koCount: number, defensePartyCount = 100, castleId = 1, overrides: Partial<KoCastleObservation> = {}): KoCastleObservation {
  return { castleId, defenderGuildId: "D", defenderGuildName: "Defender", attackerGuildId: "A", attackerGuildName: "Attacker",
    koCount, defensePartyCount, attackPartyCount: 100, observedAt: new Date("2026-11-04T12:00:00Z"), ...overrides };
}
test("reconnect rebases castles separately and keeps their prior totals", () => {
  const accumulator = new KoAccumulator();
  for (const id of [1, 2]) { accumulator.observe(frame(0, 100, id)); accumulator.observe(frame(3, 99, id)); }
  accumulator.beginObservationEpoch(); accumulator.beginObservationEpoch();
  assert.equal(accumulator.observe(frame(50, 80, 1)).rebased, true);
  accumulator.observe(frame(53, 79, 1));
  assert.equal(accumulator.observe(frame(60, 80, 2)).rebased, true);
  accumulator.observe(frame(63, 79, 2));
  assert.equal(accumulator.getGuildTotals().get("D")?.totalVictimKoCount, 12);
});
test("ownership changes during a gap do not move old totals", () => {
  const accumulator = new KoAccumulator();
  accumulator.observe(frame(0)); accumulator.observe(frame(3, 99));
  accumulator.beginObservationEpoch();
  accumulator.observe(frame(50, 80, 1, { defenderGuildId: "NEW" }));
  accumulator.observe(frame(53, 79, 1, { defenderGuildId: "NEW" }));
  assert.equal(accumulator.getGuildTotals().get("D")?.totalVictimKoCount, 3);
  assert.equal(accumulator.getGuildTotals().get("NEW")?.totalVictimKoCount, 3);
});
test("unresolved evidence is closed at the next epoch baseline", () => {
  const accumulator = new KoAccumulator();
  accumulator.observe(frame(0)); accumulator.observe(frame(3));
  accumulator.beginObservationEpoch();
  const result = accumulator.observe(frame(50, 80));
  assert.deepEqual(result.state.closedUnresolvedKo, [3, 3]);
  assert.equal(accumulator.getGuildTotals().size, 0);
});
test("snapshot restore holds totals without charging the missed interval", () => {
  const accumulator = new KoAccumulator();
  accumulator.observe(frame(0)); accumulator.observe(frame(3, 99));
  const restored = new KoAccumulator(accumulator.exportSnapshot());
  assert.equal(restored.observe(frame(70, 80)).rebased, true);
  restored.observe(frame(73, 79));
  assert.equal(restored.getGuildTotals().get("D")?.totalVictimKoCount, 6);
  assert.equal(restored.currentRevision, 4);
});
test("inputs, returned states and exported snapshots cannot mutate the accumulator", () => {
  const accumulator = new KoAccumulator();
  const initial = frame(0); accumulator.observe(initial); initial.observedAt.setTime(0);
  const result = accumulator.observe(frame(3, 99));
  const snapshot = accumulator.exportSnapshot();
  result.state.guildVictimKoTotals.D.totalVictimKoCount = 999;
  result.state.candidates[0].min[0] = 999;
  snapshot.castleStates[0].guildVictimKoTotals.D.totalVictimKoCount = 999;
  assert.equal(accumulator.getGuildTotals().get("D")?.totalVictimKoCount, 3);
  assert.equal(accumulator.exportSnapshot().castleStates[0].candidates[0].min[0], 0);
});
