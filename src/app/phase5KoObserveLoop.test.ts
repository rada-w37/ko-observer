import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import type { GvgRealtimeClient } from "../mentemori/realtimeClient.js";
import { runPhase5KoObserveLoop } from "./phase5KoObserveLoop.js";
import type { AppConfig } from "./config.js";

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

type GuildKoTotalWriteInput = {
  guildName: string | null;
  totalVictimKoCount: number;
  updatedAt: Date;
  sourceUpdatedAt: Date;
};

function createConfig(): AppConfig {
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

function createRealtimeClientStub(): GvgRealtimeClient {
  return {
    addEventListener: () => () => {},
    connect: async () => {},
    disconnect: () => {},
  } as unknown as GvgRealtimeClient;
}
