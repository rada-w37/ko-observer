import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import type { GvgRealtimeClient, GvgRealtimeClientEvent } from "../mentemori/realtimeClient.js";
import { runPhase5KoObserveLoop } from "./phase5KoObserveLoop.js";
import type { AppConfig } from "./config.js";
import { buildGvgStreamId } from "../mentemori/streamId.js";
import { calculateGuildKoTotals } from "../koo/koAttribution.js";
import type { ObservationCheckpoint, ObservationIdentity, ObservationLease, ObservationRunStore } from "../koo/observationRun.js";
import { NoopNotificationCoordinator, type NotificationCoordinator } from "../notifications/application/notificationCoordinator.js";
import type { BattleSubscriptionScope } from "../koo/battleScopeResolver.js";

class MemoryStore implements ObservationRunStore {
  checkpoint?: ObservationCheckpoint;
  commits: ObservationCheckpoint[] = [];
  releases = 0;
  async acquire() { return { ownerId: "test", fenceToken: 1, validUntil: 1e9 }; }
  async renew(lease: ObservationLease) { return lease; }
  async resume(_lease: ObservationLease, identity: ObservationIdentity, participants: Record<string, string>, startedAt: Date) {
    const resumed = this.checkpoint?.identity.sessionId === identity.sessionId;
    this.checkpoint ??= { schemaVersion: 2, identity, accumulator: { revision: 0, castleStates: [] }, guildNames: { ...participants }, participantGuilds: { ...participants }, updatedAt: startedAt };
    return { checkpoint: structuredClone(this.checkpoint), resumed };
  }
  async commit(_lease: ObservationLease, checkpoint: ObservationCheckpoint) {
    this.checkpoint = structuredClone(checkpoint); this.commits.push(structuredClone(checkpoint));
  }
  async release() { this.releases++; }
  totals() { return calculateGuildKoTotals(this.checkpoint?.accumulator.castleStates ?? []); }
}

const guildScope: BattleSubscriptionScope = { battleType: "guildBattle", subscriptionType: "guildBattle", worldId: "1037", guildId: "111111111037", worldGroupId: null, classId: null, blockId: null };
const grandScope: BattleSubscriptionScope = { battleType: "grandBattle", subscriptionType: "grandBattle", worldId: "1037", guildId: "111111111037", worldGroupId: 12, classId: 3, blockId: 2,
  participantGuilds: [{ guildId: "111111111020", guildName: "A" }, { guildId: "222222222034", guildName: "B" }, { guildId: "333333333037", guildName: "C" }, { guildId: "444444444012", guildName: "D" }] };

async function run(payloads: Uint8Array[] = [castle()], overrides: Partial<Parameters<typeof runPhase5KoObserveLoop>[2]> = {}, store = new MemoryStore(), scope = guildScope, configOverrides: Partial<AppConfig> = {}) {
  let clock = 0;
  const config: AppConfig = { firebaseProjectId: "test", firebaseClientEmail: "test@example.invalid", firebasePrivateKey: "stub", mode: "phase5-ko-observe-loop", runId: "test", worldId: "1037", guildId: "111111111037", observeDurationSeconds: 1, observeIntervalSeconds: 1, seedClear: true, notificationsEnabled: false, notificationsDryRun: true, ...configOverrides };
  let listener: ((event: GvgRealtimeClientEvent) => void) | undefined;
  const client = { addEventListener(callback: typeof listener) { listener = callback; return () => { listener = undefined; }; }, async connect() {
    listener?.({ type: "opened" }); listener?.({ type: "subscriptionSent" }); for (const payload of payloads) listener?.({ type: "payloadReceived", payload });
  }, disconnect() {} } as unknown as GvgRealtimeClient;
  await runPhase5KoObserveLoop(config, {} as Firestore, { createRealtimeClient: () => client, createStore: () => store,
    resolveBattleSubscriptionScope: async () => scope, createNotificationCoordinator: async () => new NoopNotificationCoordinator(),
    now: () => new Date(Date.parse("2026-06-11T12:00:00Z") + clock), monotonicNow: () => clock,
    sleep: async (ms) => { clock += ms; }, ...overrides });
  return store;
}

function castle(overrides: Partial<{ guildId: number; attackerGuildId: number; defense: number; attack: number; ko: number }> = {}): Uint8Array {
  const bytes = new Uint8Array(24); const view = new DataView(bytes.buffer);
  view.setUint32(0, buildGvgStreamId({ castleId: 1, block: 0, worldGroupId: 0, gvgClass: 0, worldId: 1037 }), true);
  view.setUint32(4, overrides.guildId ?? 111111111, true); view.setUint32(8, overrides.attackerGuildId ?? 222222222, true);
  view.setUint16(16, overrides.defense ?? 10, true); view.setUint16(18, overrides.attack ?? 10, true);
  view.setUint8(20, 1); view.setUint16(22, overrides.ko ?? 0, true); return bytes;
}

test("initializes Grand Battle participants with zero KO in the saved run", async () => {
  const store = await run([castle()], {}, new MemoryStore(), grandScope);
  assert.deepEqual(store.checkpoint?.participantGuilds, Object.fromEntries(grandScope.participantGuilds.map((guild) => [guild.guildId, guild.guildName])));
  assert.equal(store.totals().size, 0);
});

test("Guild Battle does not add participant seeds", async () => {
  const store = await run(); assert.deepEqual(store.checkpoint?.participantGuilds, {});
});

test("normalizes Grand Battle short guild ids to their participant worlds", async () => {
  const store = await run([castle(), castle({ ko: 3, defense: 9 }), castle({ ko: 7, defense: 8 })], {}, new MemoryStore(), grandScope);
  assert.equal(store.totals().get("111111111020")?.totalVictimKoCount, 7);
  assert.equal(store.totals().has("111111111037"), false);
});

test("retains old owner totals after a castle ownership change", async () => {
  const store = await run([castle(), castle({ ko: 3, defense: 9 }), castle({ ko: 7, defense: 8 }), castle({ guildId: 222222222, ko: 0 }), castle({ guildId: 222222222, ko: 3, defense: 9 })]);
  assert.equal(store.totals().get("111111111037")?.totalVictimKoCount, 7);
  assert.equal(store.totals().get("222222222037")?.totalVictimKoCount, 3);
});

test("resolves production target through guildShares", async () => {
  let resolved: unknown;
  await run([castle()], { loadMonitorGuildTargetFromGuildShares: async () => ({ status: "ok", worldId: "1037", guildId: "111111111037", guildName: "A" }),
    resolveBattleSubscriptionScope: async (input) => { resolved = input; return guildScope; } }, new MemoryStore(), guildScope, { worldId: undefined, guildId: undefined });
  assert.deepEqual(resolved, { worldId: "1037", guildId: "111111111037" });
});

test("notification observe failure does not stop KO persistence", async () => {
  const coordinator = new NoopNotificationCoordinator(); coordinator.observe = () => { throw new Error("notification failed"); };
  const store = await run([castle(), castle({ ko: 3, defense: 9 }), castle({ ko: 7, defense: 8 })], { createNotificationCoordinator: async () => coordinator });
  assert.equal(store.totals().get("111111111037")?.totalVictimKoCount, 7);
});

test("notification flush failure does not prevent ownership release", async () => {
  const coordinator = new NoopNotificationCoordinator(); coordinator.flush = async () => { throw new Error("flush failed"); };
  const store = await run([castle()], { createNotificationCoordinator: async () => coordinator }); assert.equal(store.releases, 1);
});

test("passes normalized observations with display sides, names and receipt time", async () => {
  const observations: Parameters<NotificationCoordinator["observe"]>[0][] = [];
  const coordinator = new NoopNotificationCoordinator(); coordinator.observe = (input) => { observations.push(input); };
  await run([castle({ defense: 3, attack: 5 })], { createNotificationCoordinator: async () => coordinator });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].ownerGuildId, "111111111037");
  assert.equal(observations[0].attackerGuildId, "222222222037");
  assert.equal(observations[0].defenseCount, 3); assert.equal(observations[0].attackCount, 5);
  assert.equal(observations[0].observedAt.toISOString(), "2026-06-11T12:00:00.000Z");
  assert.equal(observations[0].castleName, "ブラッセル");
});

test("rule tick runs once per payload regardless of castle count", async () => {
  let ticks = 0; let observations = 0;
  const coordinator = new NoopNotificationCoordinator(); coordinator.observeRuleTick = () => { ticks++; }; coordinator.observe = () => { observations++; };
  await run([new Uint8Array([...castle(), ...castle()])], { createNotificationCoordinator: async () => coordinator });
  assert.equal(ticks, 2); assert.equal(observations, 2);
});

test("initial rule tick is delivered even when realtime never supplies a castle", async () => {
  let ticks = 0; const coordinator = new NoopNotificationCoordinator(); coordinator.observeRuleTick = () => { ticks++; };
  await assert.rejects(run([], { createNotificationCoordinator: async () => coordinator }), /without a synchronized/);
  assert.equal(ticks, 1);
});

for (const result of [{ status: "empty", message: "No guild configuration found." }, { status: "multiple", message: "Multiple guild configurations found.", count: 2 }] as const) {
  test(`does not initialize storage when guildShares is ${result.status}`, async () => {
    let created = false;
    await run([], { loadMonitorGuildTargetFromGuildShares: async () => result, createStore: () => { created = true; return new MemoryStore(); } }, new MemoryStore(), guildScope, { worldId: undefined });
    assert.equal(created, false);
  });
}

test("same battle restart resumes saved totals and rebases the first observation", async () => {
  const store = await run([castle(), castle({ ko: 3, defense: 9 }), castle({ ko: 7, defense: 8 })]);
  await run([castle({ ko: 50, defense: 80 }), castle({ ko: 53, defense: 79 })], {}, store);
  assert.equal(store.totals().get("111111111037")?.totalVictimKoCount, 10);
});
