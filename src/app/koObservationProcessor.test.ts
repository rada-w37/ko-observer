import assert from "node:assert/strict";
import test from "node:test";
import { KoObservationProcessor, type ActiveBattleScope } from "./koObservationProcessor.js";
import { createObservationIdentity, type ObservationCheckpoint } from "../koo/observationRun.js";
import { buildGvgStreamId } from "../mentemori/streamId.js";
import { GVG_CASTLE_STATE } from "../mentemori/types.js";
import { NoopNotificationCoordinator } from "../notifications/application/notificationCoordinator.js";

const observedAt = new Date("2026-11-02T11:45:01Z");
const scope: ActiveBattleScope = { battleType: "guildBattle", subscriptionType: "guildBattle", worldId: "1037",
  guildId: null, classId: null, worldGroupId: null, blockId: null };

function fixture(checkpoint: ObservationCheckpoint = {
  schemaVersion: 2, identity: createObservationIdentity("2026-11-02", "guildBattle", 1037),
  accumulator: { revision: 0, castleStates: [] }, guildNames: {}, participantGuilds: {}, updatedAt: observedAt,
}, battleScope: ActiveBattleScope = scope) {
  const logs: string[] = [];
  const processor = new KoObservationProcessor(battleScope, checkpoint, new NoopNotificationCoordinator(), "test", (line) => logs.push(line));
  return { processor, logs };
}

function castlePayload(koCount = 0, defensePartyCount = 100, guildId = 111111111): Uint8Array {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, buildGvgStreamId({ castleId: 1, worldId: 1037, block: 0, worldGroupId: 0, gvgClass: 0 }), true);
  view.setUint32(4, guildId, true); view.setUint32(8, 222222222, true);
  view.setUint16(16, defensePartyCount, true); view.setUint16(18, 100, true); view.setUint16(22, koCount, true);
  view.setUint8(20, koCount === 0 ? GVG_CASTLE_STATE.activeDeclared : GVG_CASTLE_STATE.activeBattle);
  return bytes;
}

test("progress distinguishes a confirmed KO from pending attribution", () => {
  const { processor } = fixture();
  processor.process(castlePayload(), observedAt);
  processor.process(castlePayload(3), observedAt);
  assert.match(processor.progress, /attributedKo=0 pendingKo=3\.\.3/);
  processor.process(castlePayload(6, 99), observedAt);
  assert.match(processor.progress, /attributedKo=6 pendingKo=0\.\.0/);
});

test("reconnect makes closed evidence publishable without another observation of the castle", () => {
  const { processor } = fixture();
  processor.process(castlePayload(), observedAt);
  processor.process(castlePayload(3), observedAt);
  const before = processor.takePublication(observedAt);
  processor.beginObservationEpoch();
  const after = processor.takePublication(observedAt);
  assert.equal(after.checkpoint.accumulator.revision, before.checkpoint.accumulator.revision + 1);
  assert.deepEqual(after.checkpoint.accumulator.castleStates[0].closedUnresolvedKo, [3, 3]);
  assert.match(processor.progress, /pendingKo=0\.\.0 closedUnresolvedKo=3\.\.3/);
  assert.deepEqual(after.castleIds, []);
  assert.equal(after.publishTotals, false);
});

test("publication logs input, viable transitions and confirmed credit in bounded batches", () => {
  const { processor, logs } = fixture();
  processor.process(castlePayload(), observedAt);
  processor.process(castlePayload(3, 99), observedAt);
  processor.process(castlePayload(3, 99, 222222222), observedAt);
  for (let i = 0; i < 127; i++) processor.process(castlePayload(3, 99, 222222222), observedAt);
  assert.equal(logs.length, 0);
  processor.takePublication(observedAt);
  assert.match(logs[0], /omitted=2/);
  const decisions = JSON.parse(logs[0].split(" decisions=")[1]);
  assert.equal(decisions.length, 128);
  assert.equal(decisions[1].minimumFreshPartySize, 3);
  assert.equal(decisions[1].defenseCredit, 3);
  assert.deepEqual(decisions[1].transitions, ["first_battle"]);
  assert.deepEqual(decisions[1].previous, { ko: 0, defense: 100, attack: 100 });
  assert.ok(decisions.at(-1).transitions.includes("switch"));
  processor.takePublication(observedAt);
  assert.equal(logs.length, 1);
});

test("unverified placement rules leave small KO increments as candidates", () => {
  const { processor, logs } = fixture(undefined, { ...scope, worldId: "1108" });
  processor.process(castlePayload(7), observedAt);
  processor.process(castlePayload(8, 99), observedAt);
  processor.takePublication(observedAt);
  const decisions = JSON.parse(logs[0].split(" decisions=")[1]);
  assert.equal(decisions[1].minimumFreshPartySize, null);
  assert.equal(decisions[1].defenseCredit, 1);
});

test("invalid payload diagnostics retain parser reasons and location without raw data or partial attribution", async (context) => {
  const streamId = new DataView(castlePayload().buffer).getUint32(0, true);
  const unknownStreamId = (streamId & ~31) | 22;
  const unknown = new Uint8Array(4);
  new DataView(unknown.buffer).setUint32(0, unknownStreamId, true);
  const cases = [
    { payload: new Uint8Array([1]), status: "error", reason: "payload ended before stream ID", offset: 0, streamId: null },
    { payload: castlePayload().slice(0, 4), status: "error", reason: "payload ended inside castle status message", offset: 0, streamId },
    { payload: unknown, status: "ok", reason: "unknown castle ID in stream ID: 22", offset: 0, streamId: unknownStreamId },
    { payload: new Uint8Array([...castlePayload(), 1]), status: "error", reason: "payload ended before stream ID", offset: 24, streamId: null },
  ];
  for (const example of cases) await context.test(`${example.status}: ${example.reason} at ${example.offset}`, () => {
    const { processor, logs } = fixture();
    assert.deepEqual(processor.process(example.payload, observedAt), { castleReceived: false, reconnect: true });
    assert.equal(logs.length, 1);
    const diagnostic = JSON.parse(logs[0].split(" details=")[1]);
    assert.deepEqual(diagnostic, { status: example.status, reason: example.reason,
      payloadBytes: example.payload.length, offset: example.offset, streamId: example.streamId });
    assert.match(processor.progress, /processedCastles=0 revision=0\b/);
    assert.equal(processor.accumulator.getGuildTotals().size, 0);
  });
});
