import assert from "node:assert/strict";
import test from "node:test";
import { applyKoObservation, calculateGuildKoTotals, createKoCastlePublicSnapshot, type KoCastleObservation, type KoCastleState } from "./koAttribution.js";

function observation(koCount: number, defensePartyCount = 100, attackPartyCount = 100, overrides: Partial<KoCastleObservation> = {}): KoCastleObservation {
  return { castleId: 1, defenderGuildId: "D", defenderGuildName: "Defender", attackerGuildId: "A", attackerGuildName: "Attacker",
    koCount, defensePartyCount, attackPartyCount, observedAt: new Date("2026-11-04T12:00:00Z"), ...overrides };
}
function play(...frames: KoCastleObservation[]): KoCastleState {
  let state: KoCastleState | undefined;
  for (const frame of frames) state = applyKoObservation(state, frame).state;
  return state!;
}
test("first nonzero observation is only a baseline", () => {
  assert.equal(calculateGuildKoTotals([play(observation(7))]).size, 0);
});
test("before-battle observation is not credited", () => {
  const time = new Date("2026-11-04T11:44:59Z");
  assert.equal(calculateGuildKoTotals([play(observation(0, 100, 100, { observedAt: time }), observation(3, 99, 100, { observedAt: time }))]).size, 0);
});
test("stable winner credits its increments without requiring another visible loss", () => {
  const state = play(observation(0), observation(3, 99), observation(7, 98), observation(10, 98), observation(13, 98));
  assert.equal(calculateGuildKoTotals([state]).get("D")?.totalVictimKoCount, 13);
  assert.equal(createKoCastlePublicSnapshot(state).defender.koVictimCount, 13);
});
test("defeating the last survivor credits one KO to the other side", () => {
  const state = play(observation(0), observation(5, 99), observation(10, 98), observation(1, 98, 99));
  assert.equal(state.guildVictimKoTotals.D.totalVictimKoCount, 10);
  assert.equal(state.guildVictimKoTotals.A.totalVictimKoCount, 1);
});
test("same KO can switch repeatedly when the losing parties are visible", () => {
  const state = play(observation(0, 100, 100, { castleId: 6 }), observation(2, 99, 100, { castleId: 6 }),
    observation(2, 99, 99, { castleId: 6 }), observation(2, 98, 99, { castleId: 6 }));
  assert.equal(state.guildVictimKoTotals.D.totalVictimKoCount, 4);
  assert.equal(state.guildVictimKoTotals.A.totalVictimKoCount, 2);
});
test("contradiction rebases without guessing or stopping subsequent credit", () => {
  const state = play(observation(0), observation(3, 99), observation(7, 98), observation(8, 98), observation(11, 97));
  assert.equal(state.modelMismatchCount, 1);
  assert.equal(state.guildVictimKoTotals.D.totalVictimKoCount, 10);
});
test("ambiguous KO does not change totals and later resolution is published once", () => {
  const pending = play(observation(0), observation(3, 99), observation(3, 99, 99), observation(3, 99, 99));
  assert.equal(pending.candidates.length, 2);
  const resolved = applyKoObservation(pending, observation(6, 99, 98));
  assert.equal(resolved.state.guildVictimKoTotals.A.totalVictimKoCount, 6);
  assert.equal(resolved.shouldUpdateGuildTotals, true);
  assert.equal(resolved.shouldPersistCastle, true);
  assert.equal(applyKoObservation(resolved.state, observation(6, 99, 98)).shouldUpdateGuildTotals, false);
});
test("guild replacement retains old guild totals and rebases new sides", () => {
  const state = play(observation(0), observation(3, 99), observation(7, 99, 100, { defenderGuildId: "D2" }),
    observation(10, 98, 100, { defenderGuildId: "D2" }));
  assert.equal(state.guildVictimKoTotals.D.totalVictimKoCount, 3);
  assert.equal(state.guildVictimKoTotals.D2.totalVictimKoCount, 3);
  assert.equal(createKoCastlePublicSnapshot(state).defender.koVictimCount, 3);
});
test("a zero reset closes unresolved bounds without decreasing totals", () => {
  const state = play(observation(0), observation(3, 99), observation(3, 99), observation(0, 99));
  assert.deepEqual(state.closedUnresolvedKo, [0, 3]);
  assert.equal(state.guildVictimKoTotals.D.totalVictimKoCount, 3);
});
test("guild totals combine confirmed counts across castle and side", () => {
  const defense = play(observation(0), observation(3, 99));
  const attack = play(observation(0, 100, 100, { castleId: 2, attackerGuildId: "D" }), observation(4, 100, 99, { castleId: 2, attackerGuildId: "D" }));
  assert.equal(calculateGuildKoTotals([defense, attack]).get("D")?.totalVictimKoCount, 7);
});
