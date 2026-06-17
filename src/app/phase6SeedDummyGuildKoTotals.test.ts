import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import type { AppConfig } from "./config.js";
import { runPhase6SeedDummyGuildKoTotals } from "./phase6SeedDummyGuildKoTotals.js";
import type { LocalGvgLatest } from "../mentemori/types.js";

const baseConfig: AppConfig = {
  firebaseProjectId: "project",
  firebaseClientEmail: "client@example.com",
  firebasePrivateKey: "private-key",
  mode: "phase6-seed-dummy-guild-ko-totals",
  runId: "local",
  worldId: "1037",
  observeDurationSeconds: 120,
  observeIntervalSeconds: 1,
  seedClear: true,
  notificationsEnabled: false,
  notificationsDryRun: true,
};

test("seeds dummy guild KO totals from real localgvg guild ids", async () => {
  let clearCalled = false;
  let metaSavedAt: Date | undefined;
  const writtenTotals = new Map<string, { guildName: string | null; totalVictimKoCount: number; updatedAt: Date }>();

  const result = await runPhase6SeedDummyGuildKoTotals(baseConfig, {} as Firestore, {
    now: () => new Date("2026-06-10T12:00:00.000Z"),
    fetchLatestLocalGvg: async () => createLocalGvgLatest(),
    clearGuildKoTotals: async () => {
      clearCalled = true;
      return 2;
    },
    writeSeedGuildKoTotals: async (_firestore, input) => {
      for (const [guildId, total] of input) {
        writtenTotals.set(guildId, total);
      }
    },
    writeKoObserverRunMeta: async (_firestore, lastStartedAt) => {
      metaSavedAt = lastStartedAt;
    },
  });

  assert.equal(clearCalled, true);
  assert.equal(metaSavedAt?.toISOString(), "2026-06-10T12:00:00.000Z");
  assert.deepEqual([...writtenTotals.keys()], ["1037001", "1037002", "1037003", "1037004", "1037005"]);
  assert.deepEqual(
    [...writtenTotals.values()].map((total) => total.totalVictimKoCount),
    [12, 7, 3, 0, 5],
  );
  assert.equal(result.fetchedGuildCount, 6);
  assert.equal(result.selectedGuildCount, 5);
  assert.equal(result.clearedGuildKoTotalsCount, 2);
  assert.equal(result.writtenGuildKoTotalsCount, 5);
});

test("does not clear guildKoTotals when seedClear is false", async () => {
  let clearCalled = false;

  const result = await runPhase6SeedDummyGuildKoTotals(
    {
      ...baseConfig,
      seedClear: false,
    },
    {} as Firestore,
    {
      fetchLatestLocalGvg: async () => createLocalGvgLatest(),
      clearGuildKoTotals: async () => {
        clearCalled = true;
        return 1;
      },
      writeSeedGuildKoTotals: async () => undefined,
      writeKoObserverRunMeta: async () => undefined,
    },
  );

  assert.equal(clearCalled, false);
  assert.equal(result.clearedGuildKoTotalsCount, 0);
});

function createLocalGvgLatest(): LocalGvgLatest {
  return {
    worldId: 1037,
    guilds: {
      "1037001": "Guild A",
      "1037002": "Guild B",
      "1037003": "Guild C",
      "1037004": "Guild D",
      "1037005": "Guild E",
      "1037006": "Guild F",
    },
    castles: [
      createCastle(1, 1037001, 1037002),
      createCastle(2, 1037003, 1037004),
      createCastle(3, 1037005, 1037006),
    ],
  };
}

function createCastle(castleId: number, guildId: number, attackerGuildId: number) {
  return {
    CastleId: castleId,
    GuildId: guildId,
    AttackerGuildId: attackerGuildId,
    DefensePartyCount: 10,
    GvgCastleState: 1 as const,
    LastWinPartyKnockOutCount: 0,
  };
}
