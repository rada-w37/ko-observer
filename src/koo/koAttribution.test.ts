import assert from "node:assert/strict";
import test from "node:test";
import {
  applyKoObservation,
  calculateGuildKoTotals,
  createInitialKoCastleState,
  createKoCastlePublicSnapshot,
  type KoCastleObservation,
  type KoCastleState,
} from "./koAttribution.js";

test("confirms defenseVictim when estimated defense victim total exceeds 6", () => {
  const first = applyKoObservation(undefined, createObservation({ koCount: 0 }));
  const second = applyKoObservation(
    first.state,
    createObservation({ koCount: 7, defensePartyCount: 3, attackPartyCount: 10 }),
  );

  assert.equal(second.state.defenseVictimKoTotal, 7);
  assert.equal(second.state.attributionMode, "defenseVictim");
});

test("confirms attackVictim when estimated attack victim total exceeds 6", () => {
  const first = applyKoObservation(undefined, createObservation({ koCount: 0 }));
  const second = applyKoObservation(
    first.state,
    createObservation({ koCount: 7, defensePartyCount: 10, attackPartyCount: 3 }),
  );

  assert.equal(second.state.attackVictimKoTotal, 7);
  assert.equal(second.state.attributionMode, "attackVictim");
});

test("keeps unclear KO in unknownVictimKo without exposing it in public snapshot", () => {
  const first = applyKoObservation(undefined, createObservation({ koCount: 0 }));
  const second = applyKoObservation(
    first.state,
    createObservation({ koCount: 2, defensePartyCount: 9, attackPartyCount: 9 }),
  );
  const snapshot = createKoCastlePublicSnapshot(second.state);

  assert.equal(second.state.unknownVictimKo, 2);
  assert.equal(second.state.attributionMode, "unknown");
  assert.equal("unknownVictimKo" in snapshot, false);
  assert.equal("suspiciousSwitch" in snapshot, false);
});

test("handles KO decrease by resetting mode and keeping pending unknown initial KO", () => {
  const previousState = createState({
    attributionMode: "defenseVictim",
    lastKoCount: 5,
    lastDefensePartyCount: 5,
    lastAttackPartyCount: 10,
    defenseVictimKoTotal: 5,
    suspiciousSwitch: true,
  });
  const result = applyKoObservation(previousState, createObservation({ koCount: 2 }));

  assert.equal(result.shouldPersistCastle, true);
  assert.deepEqual(result.reasons, ["ko_decreased"]);
  assert.equal(result.state.attributionMode, "unknown");
  assert.equal(result.state.pendingUnknownInitialKo, 2);
  assert.equal(result.state.suspiciousSwitch, false);
});

test("adds pendingUnknownInitialKo when the next victim side is determined", () => {
  const previousState = createState({
    lastKoCount: 2,
    lastDefensePartyCount: 10,
    lastAttackPartyCount: 10,
    pendingUnknownInitialKo: 2,
  });
  const result = applyKoObservation(
    previousState,
    createObservation({ koCount: 4, defensePartyCount: 8, attackPartyCount: 10 }),
  );

  assert.equal(result.state.defenseVictimKoTotal, 4);
  assert.equal(result.state.pendingUnknownInitialKo, 0);
});

test("does not fully detect difficult 2 to 3 switch while mode is confirmed", () => {
  const previousState = createState({
    attributionMode: "defenseVictim",
    lastKoCount: 2,
    lastDefensePartyCount: 10,
    lastAttackPartyCount: 10,
    defenseVictimKoTotal: 8,
  });
  const result = applyKoObservation(
    previousState,
    createObservation({ koCount: 3, defensePartyCount: 10, attackPartyCount: 9 }),
  );

  assert.equal(result.state.attributionMode, "defenseVictim");
  assert.equal(result.state.defenseVictimKoTotal, 9);
  assert.equal(result.state.suspiciousSwitch, true);
});

test("creates checkpoint save only for castles with KO changes and keeps max total for merge", () => {
  const first = applyKoObservation(undefined, createObservation({ koCount: 0 }));
  const second = applyKoObservation(
    first.state,
    createObservation({
      koCount: 7,
      defensePartyCount: 3,
      observedAt: new Date("2026-06-10T11:45:10.000Z"),
    }),
  );
  const checkpoint = applyKoObservation(
    second.state,
    createObservation({
      koCount: 7,
      defensePartyCount: 3,
      observedAt: new Date("2026-06-10T11:45:31.000Z"),
    }),
  );
  const totals = calculateGuildKoTotals([checkpoint.state]);

  assert.equal(checkpoint.shouldPersistCastle, true);
  assert.deepEqual(checkpoint.reasons, ["checkpoint_elapsed"]);
  assert.equal(totals.get("1001001")?.totalVictimKoCount, 7);
});

function createObservation(overrides: Partial<KoCastleObservation> = {}): KoCastleObservation {
  return {
    castleId: 1,
    defenderGuildId: "1001001",
    defenderGuildName: "Defender",
    attackerGuildId: "2002001",
    attackerGuildName: "Attacker",
    defensePartyCount: 10,
    attackPartyCount: 10,
    koCount: 0,
    observedAt: new Date("2026-06-10T11:45:01.000Z"),
    ...overrides,
  };
}

function createState(overrides: Partial<KoCastleState>): KoCastleState {
  return {
    ...createInitialKoCastleState(1),
    lastKoCount: 0,
    lastDefensePartyCount: 10,
    lastAttackPartyCount: 10,
    defenderGuildId: "1001001",
    defenderGuildName: "Defender",
    attackerGuildId: "2002001",
    attackerGuildName: "Attacker",
    lastObservedAt: new Date("2026-06-10T11:45:01.000Z"),
    lastUpdatedAt: new Date("2026-06-10T11:45:01.000Z"),
    ...overrides,
  };
}
