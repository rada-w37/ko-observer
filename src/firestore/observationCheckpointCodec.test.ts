import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { KoAccumulator } from "../koo/koAccumulator.js";
import { createInitialKoCastleState } from "../koo/koAttribution.js";
import { createObservationIdentity, type ObservationCheckpoint } from "../koo/observationRun.js";
import { buildGvgStreamId } from "../mentemori/streamId.js";
import { decodeObservationCheckpoint, encodeObservationCheckpoint } from "./observationCheckpointCodec.js";

function checkpoint(): ObservationCheckpoint {
  const accumulator = new KoAccumulator();
  const observation = {
    castleId: 1, defenderGuildId: "111111111037", defenderGuildName: "Defender",
    attackerGuildId: "222222222037", attackerGuildName: "Attacker",
    defensePartyCount: 100, attackPartyCount: 100, koCount: 0,
    observedAt: new Date("2026-11-02T11:45:01.123Z"),
  };
  accumulator.observe({ ...observation, observedAt: new Date("2026-11-02T11:44:59Z") });
  accumulator.observe({ ...observation, defensePartyCount: 99, koCount: 3 });
  accumulator.observe({ ...observation, defensePartyCount: 98, koCount: 7 });
  accumulator.observe({ ...observation, defensePartyCount: 98, koCount: 2 });
  accumulator.observe({ ...observation, defensePartyCount: 98, koCount: 5 });
  const snapshot = accumulator.exportSnapshot();
  snapshot.castleStates.push(createInitialKoCastleState(2));
  return {
    schemaVersion: 2,
    identity: createObservationIdentity("2026-11-02", "guildBattle", buildGvgStreamId({
      castleId: 0, block: 0, worldGroupId: 0, gvgClass: 0, worldId: 1037,
    })),
    accumulator: snapshot,
    guildNames: { "111111111037": "Defender", "222222222037": "Attacker" },
    participantGuilds: {}, updatedAt: new Date("2026-11-02T11:45:05.456Z"),
  };
}

test("checkpoint codec round-trips cumulative ledgers, pending attribution, dates and null baselines", () => {
  const original = checkpoint();
  const encoded = encodeObservationCheckpoint(original);
  const stored = encoded as any;
  assert.ok(stored.updatedAt instanceof Timestamp);
  assert.ok(stored.accumulator.castleStates[0].lastObservedAt instanceof Timestamp);
  assert.equal(stored.accumulator.castleStates[1].lastObservedAt, null);
  const restored = decodeObservationCheckpoint(encoded);
  assert.deepEqual(restored, original);
  assert.ok(restored.updatedAt instanceof Date);
  assert.equal(restored.accumulator.castleStates[0].candidates.length, 2);
  assert.equal(restored.accumulator.castleStates[0].guildVictimKoTotals["111111111037"].totalVictimKoCount, 7);
  assert.equal(restored.accumulator.castleStates[1].lastKoCount, null);
});

test("checkpoint codec does not retain mutable aliases to either caller or stored records", () => {
  const original = checkpoint();
  const expected = structuredClone(original);
  const encoded = encodeObservationCheckpoint(original);
  original.updatedAt.setTime(0);
  original.accumulator.castleStates[0].guildVictimKoTotals["111111111037"].totalVictimKoCount = 999;
  original.guildNames["111111111037"] = "Changed";
  assert.deepEqual(decodeObservationCheckpoint(encoded), expected);
  const decoded = decodeObservationCheckpoint(encoded);
  decoded.accumulator.castleStates[0].lastObservedAt!.setTime(0);
  decoded.accumulator.castleStates[0].guildVictimKoTotals["111111111037"].totalVictimKoCount = 888;
  assert.deepEqual(decodeObservationCheckpoint(encoded), expected);
});

test("checkpoint decoder rejects unsupported versions and corrupt state without changing the input", async (context) => {
  const corruptions: Array<[string, (stored: any) => void]> = [
    ["unsupported version", (stored) => { stored.schemaVersion = 99; }],
    ["wrong identity digest", (stored) => { stored.identity.sessionId = "unrelated"; }],
    ["negative revision", (stored) => { stored.accumulator.revision = -1; }],
    ["fractional revision", (stored) => { stored.accumulator.revision = 1.5; }],
    ["duplicate castle", (stored) => { stored.accumulator.castleStates.push(stored.accumulator.castleStates[0]); }],
    ["invalid castle", (stored) => { stored.accumulator.castleStates[0].castleId = 22; }],
    ["missing raw baseline", (stored) => { delete stored.accumulator.castleStates[0].lastKoCount; }],
    ["negative victim total", (stored) => { stored.accumulator.castleStates[0].defenseVictimKoTotal = -1; }],
    ["negative ledger total", (stored) => { stored.accumulator.castleStates[0].guildVictimKoTotals["111111111037"].totalVictimKoCount = -1; }],
    ["invalid attribution", (stored) => { stored.accumulator.castleStates[0].candidates[0].side = "invalid"; }],
    ["invalid flag", (stored) => { stored.accumulator.castleStates[0].modelMismatchCount = -1; }],
    ["string date", (stored) => { stored.accumulator.castleStates[0].lastObservedAt = "2026-11-02"; }],
    ["missing checkpoint date", (stored) => { delete stored.updatedAt; }],
    ["invalid guild map", (stored) => { stored.guildNames["111111111037"] = 42; }],
  ];
  for (const [label, corrupt] of corruptions) {
    await context.test(label, () => {
      const encoded = encodeObservationCheckpoint(checkpoint());
      corrupt(encoded);
      const before = JSON.stringify(encoded);
      assert.throws(() => decodeObservationCheckpoint(encoded), /unsupported or corrupt/i);
      assert.equal(JSON.stringify(encoded), before);
    });
  }
});

test("checkpoint codec rejects impossible battle dates even when their identity digest matches", () => {
  for (const battleDate of ["2026-02-30", "2026-13-01", "2026-00-01"]) {
    const original = checkpoint();
    original.identity = createObservationIdentity(battleDate, "guildBattle", original.identity.streamId);
    assert.throws(() => encodeObservationCheckpoint(original), /unsupported or corrupt/i, battleDate);
  }
});

test("checkpoint encoder rejects invalid dates without rewriting caller state", () => {
  const original = checkpoint();
  original.updatedAt = new Date(Number.NaN);
  const before = JSON.stringify(original);
  assert.throws(() => encodeObservationCheckpoint(original), /unsupported or corrupt/i);
  assert.equal(JSON.stringify(original), before);
  assert.equal(Number.isNaN(original.updatedAt.getTime()), true);
});
