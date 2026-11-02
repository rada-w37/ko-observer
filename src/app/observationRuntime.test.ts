import assert from "node:assert/strict";
import test from "node:test";
import { ObservationRuntime } from "./observationRuntime.js";
import { observationPolicy } from "./observationPolicy.js";
import { NoopNotificationCoordinator } from "../notifications/application/notificationCoordinator.js";
import { ObservationOwnershipError, type ObservationCheckpoint, type ObservationIdentity, type ObservationLease, type ObservationRunStore } from "../koo/observationRun.js";
import { calculateGuildKoTotals } from "../koo/koAttribution.js";
import type { GvgRealtimeClient, GvgRealtimeClientListener } from "../mentemori/realtimeClient.js";
import { createGuildBattleSubscriptionPayload } from "../mentemori/streamId.js";

class MemoryStore implements ObservationRunStore {
  saved?: ObservationCheckpoint;
  writes: number[] = [];
  gate?: Promise<void>;
  renewFailure?: Error;
  releases = 0;
  async acquire() { return { ownerId: "test", fenceToken: 1, validUntil: 60_000 }; }
  async renew(lease: ObservationLease) { if (this.renewFailure) throw this.renewFailure; return lease; }
  async resume(_lease: ObservationLease, identity: ObservationIdentity, participants: Record<string, string>, startedAt: Date) {
    this.saved ??= { schemaVersion: 1, identity, accumulator: { revision: 0, castleStates: [] }, guildNames: {}, participantGuilds: participants, updatedAt: startedAt };
    return { checkpoint: structuredClone(this.saved), resumed: false };
  }
  async commit(_lease: ObservationLease, checkpoint: ObservationCheckpoint) {
    this.writes.push(checkpoint.accumulator.revision);
    if (this.writes.length === 1) await this.gate;
    this.saved = structuredClone(checkpoint);
  }
  async release() { this.releases++; }
}

class Client {
  private listener?: GvgRealtimeClientListener;
  closed = 0;
  addEventListener(listener: GvgRealtimeClientListener) { this.listener = listener; return () => { this.listener = undefined; }; }
  async connect() { this.send(0); this.send(1); }
  disconnect() { this.closed++; }
  send(ko: number) {
    const bytes = new Uint8Array(24); const view = new DataView(bytes.buffer);
    view.setUint32(0, 1, true); view.setUint32(4, 111111111, true); view.setUint32(8, 222222222, true);
    view.setUint16(16, 100 - ko, true); view.setUint16(18, 100, true); view.setUint8(20, 1); view.setUint16(22, ko, true);
    this.listener?.({ type: "payloadReceived", payload: bytes });
  }
}

function fixture(store = new MemoryStore(), duringSleep: (clock: number, client: Client) => void = () => {}, signal?: AbortSignal) {
  let clock = 0;
  const client = new Client(); const logs: string[] = [];
  const runtime = new ObservationRuntime({
    scope: { battleType: "guildBattle", subscriptionType: "guildBattle", worldId: "1037", guildId: null, classId: null, worldGroupId: null, blockId: null },
    payload: createGuildBattleSubscriptionPayload("1037"), store, notifications: new NoopNotificationCoordinator(), runId: "test", durationMs: 500,
    createClient: () => client as unknown as GvgRealtimeClient,
    monotonicNow: () => clock, now: () => new Date(Date.parse("2026-11-02T12:00:00Z") + clock),
    sleep: async (ms) => { clock += ms; duringSleep(clock, client); }, signal,
    policy: { ...observationPolicy, publishIntervalMs: 100, renewIntervalMs: 100, progressIntervalMs: 50, shutdownTimeoutMs: 100 },
    log: (message) => logs.push(message),
  });
  return { runtime, store, client, logs };
}

test("receiving and attribution continue while a save is pending; latest total is finally committed", async () => {
  const store = new MemoryStore();
  let release!: () => void;
  store.gate = new Promise<void>((resolve) => { release = resolve; });
  const { runtime, client, logs } = fixture(store, (clock, source) => {
    if (clock === 200) source.send(2);
    if (clock === 250) source.send(3);
    if (clock === 300) { assert.deepEqual(store.writes, [2]); release(); }
  });
  await runtime.run();
  assert.ok(logs.some((line) => line.includes("revision=4 committedRevision=0")));
  assert.equal(calculateGuildKoTotals(store.saved!.accumulator.castleStates).get("111111111037")?.totalVictimKoCount, 3);
  assert.equal(store.saved!.accumulator.revision, 4);
  assert.equal(client.closed, 1); assert.equal(store.releases, 1);
});

test("ownership loss stops the receiver and does not claim a successful run", async () => {
  const store = new MemoryStore(); store.renewFailure = new ObservationOwnershipError("owner changed");
  const { runtime, client, logs } = fixture(store);
  await assert.rejects(runtime.run(), /owner changed/);
  assert.equal(client.closed, 1);
  assert.ok(logs.some((line) => line.includes("outcome=failed")));
  assert.ok(logs.some((line) => line.includes("outcome=failed received=2")));
});

test("cancellation stops ingress and still flushes already processed observations", async () => {
  const controller = new AbortController();
  const { runtime, client, store } = fixture(new MemoryStore(), (clock) => { if (clock === 150) controller.abort(); }, controller.signal);
  await assert.rejects(runtime.run(), /cancelled/);
  assert.equal(client.closed, 1);
  assert.equal(calculateGuildKoTotals(store.saved!.accumulator.castleStates).get("111111111037")?.totalVictimKoCount, 1);
});

test("already-cancelled startup never acquires ownership or opens a socket", async () => {
  const controller = new AbortController(); controller.abort();
  const store = new MemoryStore(); store.acquire = async () => { assert.fail("must not acquire"); };
  const { runtime, client } = fixture(store, () => {}, controller.signal);
  await assert.rejects(runtime.run(), /cancelled before startup/);
  assert.equal(client.closed, 0);
});
