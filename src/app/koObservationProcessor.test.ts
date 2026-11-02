import assert from "node:assert/strict";
import test from "node:test";
import { KoObservationProcessor, type ActiveBattleScope } from "./koObservationProcessor.js";
import { createObservationIdentity, type ObservationCheckpoint } from "../koo/observationRun.js";
import { buildGvgStreamId } from "../mentemori/streamId.js";
import { NoopNotificationCoordinator } from "../notifications/application/notificationCoordinator.js";

const observedAt = new Date("2026-11-02T11:45:01Z");
const scope: ActiveBattleScope = { battleType: "guildBattle", subscriptionType: "guildBattle", worldId: "1037",
  guildId: null, classId: null, worldGroupId: null, blockId: null };

function fixture(checkpoint: ObservationCheckpoint = {
  schemaVersion: 1, identity: createObservationIdentity("2026-11-02", "guildBattle", 1037),
  accumulator: { revision: 0, castleStates: [] }, guildNames: {}, participantGuilds: {}, updatedAt: observedAt,
}) {
  const logs: string[] = [];
  const processor = new KoObservationProcessor(scope, checkpoint, new NoopNotificationCoordinator(), "test", (line) => logs.push(line));
  return { processor, logs };
}

function castlePayload(koCount = 0, defensePartyCount = 100, guildId = 111111111): Uint8Array {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, buildGvgStreamId({ castleId: 1, worldId: 1037, block: 0, worldGroupId: 0, gvgClass: 0 }), true);
  view.setUint32(4, guildId, true); view.setUint32(8, 222222222, true);
  view.setUint16(16, defensePartyCount, true); view.setUint16(18, 100, true); view.setUint16(22, koCount, true);
  return bytes;
}

test("progress distinguishes attributed KO from excluded unknown KO without logging every observation", () => {
  for (const [defense, attributed, unknown] of [[99, 1, 0], [100, 0, 1]]) {
    const { processor, logs } = fixture();
    processor.process(castlePayload(), observedAt);
    processor.process(castlePayload(1, defense), observedAt);
    assert.match(processor.progress, new RegExp(`\\battributedKo=${attributed}\\b`));
    assert.match(processor.progress, new RegExp(`\\bunknownKo=${unknown}\\b`));
    assert.match(processor.progress, /"ko_increased":1/);
    assert.deepEqual(logs, []);
  }
});

test("progress explains pending attribution, time exclusion, checkpoints and guild changes", () => {
  const { processor } = fixture();
  processor.process(castlePayload(), new Date("2026-11-02T11:44:59Z"));
  processor.process(castlePayload(), observedAt);
  processor.process(castlePayload(7, 93), observedAt);
  processor.process(castlePayload(7, 93), new Date("2026-11-02T11:45:31Z"));
  processor.process(castlePayload(2, 93), new Date("2026-11-02T11:45:32Z"));
  assert.match(processor.progress, /pendingInitialKo=2\b/);
  processor.process(castlePayload(3, 92), new Date("2026-11-02T11:45:33Z"));
  processor.process(castlePayload(3, 92, 333333333), new Date("2026-11-02T11:45:34Z"));
  assert.match(processor.progress, /attributedKo=10\b/);
  assert.match(processor.progress, /pendingInitialKo=0\b/);
  const decisions = JSON.parse(processor.progress.split("decisions=")[1]);
  assert.deepEqual(decisions, { ko_increased: 2, ko_decreased: 1, checkpoint_elapsed: 2,
    guilds_changed: 1, rebased: 0, before_battle: 1, initial_or_unchanged: 2 });
});

test("resume and reconnect report preserved totals and count each new baseline without crediting missing KO", () => {
  const original = fixture().processor;
  original.process(castlePayload(), observedAt);
  original.process(castlePayload(7, 93), observedAt);
  const { processor } = fixture(original.takePublication(observedAt).checkpoint);
  assert.match(processor.progress, /processedCastles=0\b/);
  assert.match(processor.progress, /attributedKo=7\b/);
  processor.process(castlePayload(50, 50), observedAt);
  processor.accumulator.beginObservationEpoch();
  processor.process(castlePayload(80, 20), observedAt);
  assert.match(processor.progress, /attributedKo=7\b/);
  assert.match(processor.progress, /"rebased":2/);
  assert.match(processor.progress, /"ko_increased":0/);
  processor.process(castlePayload(81, 19), observedAt);
  assert.match(processor.progress, /attributedKo=8\b/);
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
