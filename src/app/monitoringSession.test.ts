import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import type { GvgRealtimeClient, GvgRealtimeClientEvent, GvgRealtimeClientListener } from "../mentemori/realtimeClient.js";
import { MonitoringSession } from "./monitoringSession.js";
import { observationPolicy } from "./observationPolicy.js";

class FakeClient {
  private listeners = new Set<GvgRealtimeClientListener>();
  readonly retainedListeners: GvgRealtimeClientListener[] = [];
  disconnected = 0;
  constructor(private readonly initialPayload = true) {}
  addEventListener(listener: GvgRealtimeClientListener) {
    this.listeners.add(listener);
    this.retainedListeners.push(listener);
    return () => { this.listeners.delete(listener); };
  }
  async connect() {
    this.emit({ type: "opened" });
    this.emit({ type: "subscriptionSent" });
    if (this.initialPayload) this.emit({ type: "payloadReceived", payload: new Uint8Array([1]) });
  }
  disconnect() { this.disconnected++; }
  emit(event: GvgRealtimeClientEvent) { for (const listener of this.listeners) listener(event); }
  staleEmit(event: GvgRealtimeClientEvent) { for (const listener of this.retainedListeners) listener(event); }
  get client() { return this as unknown as GvgRealtimeClient; }
}

test("keeps a quiet but synchronized connection for 3000 virtual seconds", async () => {
  let clock = 0;
  let epochs = 0;
  let progressLogs = 0;
  const client = new FakeClient();
  const session = new MonitoringSession({ payload: new Uint8Array(4), durationMs: 3_000_000,
    createClient: () => client.client, onEpoch: () => { epochs++; }, onPayload: () => ({ castleReceived: true }),
    onTick: () => {}, onProgress: () => "revision=1", log: (message) => { if (message.startsWith("progress")) progressLogs++; },
    monotonicNow: () => clock, sleep: async (ms) => { clock += ms; }, random: () => 0 });
  assert.deepEqual(await session.run(), { outcome: "completed", receivedCount: 1, reconnectCount: 0 });
  assert.equal(epochs, 1);
  assert.equal(client.disconnected, 1);
  assert.equal(progressLogs, 99);
  assert.equal(clock, 3_000_000);
});

test("reconnects using a new epoch and ignores old client events", async () => {
  let clock = 0;
  let epochs = 0;
  let processed = 0;
  const clients: FakeClient[] = [];
  let closed = false;
  let staleSent = false;
  const session = new MonitoringSession({ payload: new Uint8Array(4), durationMs: 3000,
    createClient: () => { const client = new FakeClient(); clients.push(client); return client.client; },
    onEpoch: () => { epochs++; }, onPayload: () => { processed++; return { castleReceived: true }; },
    onTick: () => {}, onProgress: () => "", log: () => {}, monotonicNow: () => clock, random: () => 0,
    sleep: async (ms) => {
      clock += ms;
      if (!closed && clock >= 100) { closed = true; clients[0].emit({ type: "disconnected", reason: "network", code: 1006 }); }
      if (clients.length === 2 && !staleSent) {
        staleSent = true;
        clients[0].staleEmit({ type: "payloadReceived", payload: new Uint8Array([99]) });
        clients[0].staleEmit({ type: "disconnected", reason: "late close" });
      }
    } });
  assert.deepEqual(await session.run(), { outcome: "completed_with_gaps", receivedCount: 2, reconnectCount: 1 });
  assert.equal(epochs, 2);
  assert.equal(processed, 2);
  assert.equal(clients.length, 2);
  assert.equal(clients[0].disconnected, 1);
  assert.equal(clients[1].disconnected, 1);
});

test("initial castle data timeout reconnects even when the socket opened successfully", async () => {
  let clock = 0;
  const clients: FakeClient[] = [];
  const session = new MonitoringSession({ payload: new Uint8Array(4), durationMs: 3000,
    createClient: () => { const client = new FakeClient(clients.length > 0); clients.push(client); return client.client; },
    onEpoch: () => {}, onPayload: () => ({ castleReceived: true }), onTick: () => {}, onProgress: () => "", log: () => {},
    policy: { ...observationPolicy, firstCastleTimeoutMs: 100 }, monotonicNow: () => clock,
    sleep: async (ms) => { clock += ms; }, random: () => 0 });
  const result = await session.run();
  assert.equal(result.outcome, "completed_with_gaps");
  assert.equal(result.reconnectCount, 1);
  assert.equal(clients.length, 2);
});

test("does not report success if the final connection is still disconnected", async () => {
  let clock = 0;
  const client = new FakeClient();
  const session = new MonitoringSession({ payload: new Uint8Array(4), durationMs: 200,
    createClient: () => client.client, onEpoch: () => {}, onPayload: () => ({ castleReceived: true }),
    onTick: () => {}, onProgress: () => "", log: () => {}, monotonicNow: () => clock,
    sleep: async (ms) => { clock += ms; if (clock === 150) client.emit({ type: "disconnected", reason: "network" }); } });
  await assert.rejects(session.run(), /without a synchronized connection/);
  assert.equal(client.disconnected, 1);
});

test("a process restart is included in the completed-with-gaps outcome", async () => {
  let clock = 0;
  const client = new FakeClient();
  const session = new MonitoringSession({ payload: new Uint8Array(4), durationMs: 100, resumed: true,
    createClient: () => client.client, onEpoch: () => {}, onPayload: () => ({ castleReceived: true }),
    onTick: () => {}, onProgress: () => "", log: () => {}, monotonicNow: () => clock, sleep: async (ms) => { clock += ms; } });
  assert.equal((await session.run()).outcome, "completed_with_gaps");
});

test("cancellation and fatal save failures close the connection instead of extending the run", async () => {
  for (const cancellation of [true, false]) {
    let clock = 0;
    const client = new FakeClient();
    const controller = new AbortController();
    const session = new MonitoringSession({ payload: new Uint8Array(4), durationMs: 3000, signal: controller.signal,
      createClient: () => client.client, onEpoch: () => {}, onPayload: () => ({ castleReceived: true }),
      onTick: () => { if (!cancellation && clock >= 100) throw new Error("save failed"); },
      onProgress: () => "", log: () => {}, monotonicNow: () => clock,
      sleep: async (ms) => { clock += ms; if (cancellation && clock >= 100) controller.abort(); } });
    await assert.rejects(session.run(), cancellation ? /cancelled/ : /save failed/);
    assert.equal(clock, 100);
    assert.equal(client.disconnected, 1);
  }
});

test("an unresolved connect promise does not block the observation deadline", async () => {
  const client = new FakeClient(false);
  client.connect = () => new Promise<void>(() => {});
  const started = performance.now();
  const session = new MonitoringSession({ payload: new Uint8Array(4), durationMs: 20,
    createClient: () => client.client, onEpoch: () => {}, onPayload: () => ({ castleReceived: false }),
    onTick: () => {}, onProgress: () => "", log: () => {}, policy: { ...observationPolicy, tickMs: 5 } });
  await assert.rejects(session.run(), /without a synchronized connection/);
  assert.ok(performance.now() - started < 1000);
  assert.equal(client.disconnected, 1);
});
