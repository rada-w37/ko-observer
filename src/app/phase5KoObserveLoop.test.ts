import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import type { GvgRealtimeClient } from "../mentemori/realtimeClient.js";
import { runPhase5KoObserveLoop } from "./phase5KoObserveLoop.js";
import type { AppConfig } from "./config.js";
import { buildGvgStreamId } from "../mentemori/streamId.js";
import type {
  NotificationCoordinator,
} from "../notifications/application/notificationCoordinator.js";
import type {
  NotificationObservation,
} from "../notifications/domain/notificationDomain.js";

test("initializes Grand Battle participant guildKoTotals with zero KO", async () => {
  const writtenTotals: Array<Map<string, GuildKoTotalWriteInput>> = [];

  await runPhase5KoObserveLoop(createConfig(), createFirestoreStub(), {
    createRealtimeClient: () => createRealtimeClientStub(),
    initializePhase5KoObserverRun: async () => ({
      deletedCastleKoDetailsCount: 0,
      deletedGuildKoTotalsCount: 0,
    }),
    resolveBattleSubscriptionScope: async () => ({
      battleType: "grandBattle",
      subscriptionType: "grandBattle",
      worldId: "1050",
      guildId: "111111111050",
      worldGroupId: 12,
      classId: 3,
      blockId: 2,
      participantGuilds: [
        { guildId: "111111111050", guildName: "Guild A" },
        { guildId: "222222222050", guildName: "Guild B" },
        { guildId: "333333333050", guildName: "Guild C" },
        { guildId: "444444444050", guildName: "Guild D" },
      ],
    }),
    writeCastleKoDetail: async () => {},
    writeGuildKoTotals: async (_firestore, guildKoTotals) => {
      writtenTotals.push(new Map(guildKoTotals));
    },
    now: createShortRunClock(),
  });

  assert.equal(writtenTotals.length, 1);
  assert.equal(writtenTotals[0]?.size, 4);
  assert.deepEqual(writtenTotals[0]?.get("111111111050"), {
    guildName: "Guild A",
    totalVictimKoCount: 0,
    updatedAt: new Date("2026-06-11T12:00:00.000Z"),
    sourceUpdatedAt: new Date("2026-06-11T12:00:00.000Z"),
  });
});

test("does not initialize guildKoTotals for Guild Battle scope", async () => {
  let writeCount = 0;

  await runPhase5KoObserveLoop(createConfig(), createFirestoreStub(), {
    createRealtimeClient: () => createRealtimeClientStub(),
    initializePhase5KoObserverRun: async () => ({
      deletedCastleKoDetailsCount: 0,
      deletedGuildKoTotalsCount: 0,
    }),
    resolveBattleSubscriptionScope: async () => ({
      battleType: "guildBattle",
      subscriptionType: "guildBattle",
      worldId: "1001",
      guildId: null,
      worldGroupId: null,
      classId: null,
      blockId: null,
    }),
    writeCastleKoDetail: async () => {},
    writeGuildKoTotals: async () => {
      writeCount += 1;
    },
    now: createShortRunClock(),
  });

  assert.equal(writeCount, 0);
});

test("aggregates Grand Battle realtime short guildId into participant guildId", async () => {
  const writtenTotals: Array<Map<string, GuildKoTotalWriteInput>> = [];

  await runPhase5KoObserveLoop(createConfig(), createFirestoreStub(), {
    createRealtimeClient: () =>
      createRealtimeClientStub([
        createCastleStatusBytes({ guildId: 110796857, koCount: 0, defensePartyCount: 10 }),
        createCastleStatusBytes({ guildId: 110796857, koCount: 7, defensePartyCount: 3 }),
      ]),
    initializePhase5KoObserverRun: async () => ({
      deletedCastleKoDetailsCount: 0,
      deletedGuildKoTotalsCount: 0,
    }),
    resolveBattleSubscriptionScope: async () => ({
      battleType: "grandBattle",
      subscriptionType: "grandBattle",
      worldId: "1037",
      guildId: "110796857037",
      worldGroupId: 12,
      classId: 3,
      blockId: 2,
      participantGuilds: [
        { guildId: "110796857020", guildName: "Guild A" },
        { guildId: "562434163034", guildName: "Guild B" },
        { guildId: "576802057037", guildName: "Guild C" },
        { guildId: "844121064012", guildName: "Guild D" },
      ],
    }),
    writeCastleKoDetail: async () => {},
    writeGuildKoTotals: async (_firestore, guildKoTotals) => {
      writtenTotals.push(new Map(guildKoTotals));
    },
    now: createShortRunClock(),
    sleep: async () => {},
  });

  assert.equal(writtenTotals.length, 2);
  assert.equal(writtenTotals[0]?.has("110796857020"), true);
  assert.equal(writtenTotals[1]?.has("110796857020"), true);
  assert.equal(writtenTotals[1]?.has("110796857037"), false);
  assert.equal(writtenTotals[1]?.get("110796857020")?.totalVictimKoCount, 7);
});

test("resolves monitor target from guildShares when manual world is not set", async () => {
  let resolvedInput: { worldId: string; guildId?: string } | null = null;

  await runPhase5KoObserveLoop(createConfig({ worldId: undefined, guildId: undefined }), createFirestoreStub(), {
    createRealtimeClient: () => createRealtimeClientStub(),
    initializePhase5KoObserverRun: async () => ({
      deletedCastleKoDetailsCount: 0,
      deletedGuildKoTotalsCount: 0,
    }),
    loadMonitorGuildTargetFromGuildShares: async () => ({
      status: "ok",
      worldId: "1037",
      guildId: "111111111037",
      guildName: "Guild A",
    }),
    resolveBattleSubscriptionScope: async (input) => {
      resolvedInput = input;
      return {
        battleType: "guildBattle",
        subscriptionType: "guildBattle",
        worldId: input.worldId,
        guildId: input.guildId ?? null,
        worldGroupId: null,
        classId: null,
        blockId: null,
      };
    },
    writeCastleKoDetail: async () => {},
    writeGuildKoTotals: async () => {},
    now: createShortRunClock(),
  });

  assert.deepEqual(resolvedInput, {
    worldId: "1037",
    guildId: "111111111037",
  });
});

test("keeps KO saves running when notification observe throws", async () => {
  const writtenTotals: Array<Map<string, GuildKoTotalWriteInput>> = [];
  const notificationCoordinator = createNotificationCoordinatorStub({
    observe: () => {
      throw new Error("notification failure");
    },
  });

  await runPhase5KoObserveLoop(createConfig({ notificationsEnabled: true }), createFirestoreStub(), {
    createRealtimeClient: () =>
      createRealtimeClientStub([
        createCastleStatusBytes({ guildId: 110796857, koCount: 0, defensePartyCount: 10 }),
        createCastleStatusBytes({ guildId: 110796857, koCount: 7, defensePartyCount: 3 }),
      ]),
    initializePhase5KoObserverRun: async () => ({
      deletedCastleKoDetailsCount: 0,
      deletedGuildKoTotalsCount: 0,
    }),
    resolveBattleSubscriptionScope: async () => ({
      battleType: "grandBattle",
      subscriptionType: "grandBattle",
      worldId: "1037",
      guildId: "110796857037",
      worldGroupId: 12,
      classId: 3,
      blockId: 2,
      participantGuilds: [
        { guildId: "110796857020", guildName: "Guild A" },
        { guildId: "562434163034", guildName: "Guild B" },
        { guildId: "576802057037", guildName: "Guild C" },
        { guildId: "844121064012", guildName: "Guild D" },
      ],
    }),
    createNotificationCoordinator: async () => notificationCoordinator,
    writeCastleKoDetail: async () => {},
    writeGuildKoTotals: async (_firestore, guildKoTotals) => {
      writtenTotals.push(new Map(guildKoTotals));
    },
    now: createShortRunClock(),
    sleep: async () => {},
  });

  assert.equal(writtenTotals.length, 2);
  assert.equal(writtenTotals[1]?.get("110796857020")?.totalVictimKoCount, 7);
});

test("flushes notifications in finally without blocking loop completion on failure", async () => {
  let flushCalled = false;
  const notificationCoordinator = createNotificationCoordinatorStub({
    flush: async () => {
      flushCalled = true;
      throw new Error("flush failure");
    },
  });

  await runPhase5KoObserveLoop(createConfig({ notificationsEnabled: true }), createFirestoreStub(), {
    createRealtimeClient: () => createRealtimeClientStub(),
    initializePhase5KoObserverRun: async () => ({
      deletedCastleKoDetailsCount: 0,
      deletedGuildKoTotalsCount: 0,
    }),
    resolveBattleSubscriptionScope: async () => ({
      battleType: "guildBattle",
      subscriptionType: "guildBattle",
      worldId: "1001",
      guildId: "111111111001",
      worldGroupId: null,
      classId: null,
      blockId: null,
    }),
    createNotificationCoordinator: async () => notificationCoordinator,
    writeCastleKoDetail: async () => {},
    writeGuildKoTotals: async () => {},
    now: createShortRunClock(),
  });

  assert.equal(flushCalled, true);
});

test("passes read-only notification observation after castle state update", async () => {
  const observations: NotificationObservation[] = [];

  await runPhase5KoObserveLoop(createConfig({ notificationsEnabled: true }), createFirestoreStub(), {
    createRealtimeClient: () =>
      createRealtimeClientStub([
        createCastleStatusBytes({
          guildId: 111111111,
          attackerGuildId: 222222222,
          defensePartyCount: 3,
          attackPartyCount: 5,
          koCount: 0,
        }),
      ]),
    initializePhase5KoObserverRun: async () => ({
      deletedCastleKoDetailsCount: 0,
      deletedGuildKoTotalsCount: 0,
    }),
    resolveBattleSubscriptionScope: async () => ({
      battleType: "guildBattle",
      subscriptionType: "guildBattle",
      worldId: "1001",
      guildId: "111111111001",
      worldGroupId: null,
      classId: null,
      blockId: null,
    }),
    createNotificationCoordinator: async () =>
      createNotificationCoordinatorStub({
        observe: (observation) => {
          observations.push(observation);
        },
      }),
    writeCastleKoDetail: async () => {},
    writeGuildKoTotals: async () => {},
    now: createShortRunClock(),
    sleep: async () => {},
  });

  assert.equal(observations.length, 1);
  assert.deepEqual(observations[0], {
    guildId: "111111111001",
    battleType: "guildBattle",
    castleId: 1,
    castleName: "ブラッセル",
    ownerGuildId: "111111111001",
    attackerGuildId: "222222222001",
    attackerGuildName: null,
    defenseCount: 3,
    attackCount: 5,
    observedAt: new Date("2026-06-11T12:00:02.000Z"),
    worldId: "1001",
    runId: "test",
  });
});

test("stops when guildShares has no monitor target", async () => {
  let initialized = false;

  await runPhase5KoObserveLoop(createConfig({ worldId: undefined, guildId: undefined }), createFirestoreStub(), {
    createRealtimeClient: () => createRealtimeClientStub(),
    initializePhase5KoObserverRun: async () => {
      initialized = true;
      return {
        deletedCastleKoDetailsCount: 0,
        deletedGuildKoTotalsCount: 0,
      };
    },
    loadMonitorGuildTargetFromGuildShares: async () => ({
      status: "empty",
      message: "No guild configuration found.",
    }),
    writeCastleKoDetail: async () => {},
    writeGuildKoTotals: async () => {},
    now: createShortRunClock(),
  });

  assert.equal(initialized, false);
});

test("stops when guildShares has multiple monitor targets", async () => {
  let initialized = false;

  await runPhase5KoObserveLoop(createConfig({ worldId: undefined, guildId: undefined }), createFirestoreStub(), {
    createRealtimeClient: () => createRealtimeClientStub(),
    initializePhase5KoObserverRun: async () => {
      initialized = true;
      return {
        deletedCastleKoDetailsCount: 0,
        deletedGuildKoTotalsCount: 0,
      };
    },
    loadMonitorGuildTargetFromGuildShares: async () => ({
      status: "multiple",
      message: "Multiple guild configurations found.",
      count: 2,
    }),
    writeCastleKoDetail: async () => {},
    writeGuildKoTotals: async () => {},
    now: createShortRunClock(),
  });

  assert.equal(initialized, false);
});

type GuildKoTotalWriteInput = {
  guildName: string | null;
  totalVictimKoCount: number;
  updatedAt: Date;
  sourceUpdatedAt: Date;
};

function createConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    firebaseProjectId: "project",
    firebaseClientEmail: "client@example.com",
    firebasePrivateKey: "private-key",
    mode: "phase5-ko-observe-loop",
    runId: "test",
    worldId: "1050",
    guildId: "111111111050",
    observeDurationSeconds: 1,
    observeIntervalSeconds: 1,
    seedClear: true,
    notificationsEnabled: false,
    notificationsDryRun: true,
    ...overrides,
  };
}

function createShortRunClock(): () => Date {
  let callCount = 0;
  return () => {
    callCount += 1;
    return callCount === 1
      ? new Date("2026-06-11T12:00:00.000Z")
      : new Date("2026-06-11T12:00:02.000Z");
  };
}

function createFirestoreStub(): Firestore {
  return {} as Firestore;
}

function createRealtimeClientStub(payloads: number[][] = []): GvgRealtimeClient {
  type TestRealtimeEvent =
    | { type: "opened" }
    | { type: "subscriptionSent" }
    | { type: "payloadReceived"; payload: number[] }
    | { type: "disconnected"; reason?: string };
  let listener: ((event: TestRealtimeEvent) => void) | null = null;

  return {
    addEventListener: (eventListener: typeof listener) => {
      listener = eventListener;
      return () => {};
    },
    connect: async () => {
      listener?.({ type: "opened" });
      listener?.({ type: "subscriptionSent" });
      for (const payload of payloads) {
        listener?.({ type: "payloadReceived", payload });
      }
    },
    disconnect: (reason?: string) => {
      listener?.({ type: "disconnected", reason });
    },
  } as unknown as GvgRealtimeClient;
}

function createNotificationCoordinatorStub(
  overrides: Partial<NotificationCoordinator> = {},
): NotificationCoordinator {
  return {
    observe: () => {},
    flush: async () => ({
      timedOut: false,
      pendingCount: 0,
      createdCount: 0,
      duplicateCount: 0,
      dryRunCount: 0,
      skippedCount: 0,
      failedCount: 0,
    }),
    ...overrides,
  };
}

function createCastleStatusBytes(
  overrides: Partial<{
    guildId: number;
    attackerGuildId: number;
    defensePartyCount: number;
    attackPartyCount: number;
    koCount: number;
  }> = {},
): number[] {
  const castleStreamId = buildGvgStreamId({
    castleId: 1,
    block: 2,
    worldGroupId: 12,
    gvgClass: 3,
    worldId: 0,
  });
  return [
    ...writeUint32(castleStreamId),
    ...writeUint32(overrides.guildId ?? 110796857),
    ...writeUint32(overrides.attackerGuildId ?? 0),
    ...writeUint32(0),
    ...writeUint16(overrides.defensePartyCount ?? 10),
    ...writeUint16(overrides.attackPartyCount ?? 0),
    1,
    0,
    ...writeUint16(overrides.koCount ?? 0),
  ];
}

function writeUint32(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return [...bytes];
}

function writeUint16(value: number): number[] {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return [...bytes];
}
