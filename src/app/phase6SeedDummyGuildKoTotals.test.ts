import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import type { AppConfig } from "./config.js";
import { runPhase6SeedDummyGuildKoTotals } from "./phase6SeedDummyGuildKoTotals.js";
import type { LocalGvgLatest } from "../mentemori/types.js";
const baseConfig: AppConfig = { firebaseProjectId: "test", firebaseClientEmail: "test@example.invalid", firebasePrivateKey: "stub", mode: "phase6-seed-dummy-guild-ko-totals", runId: "test", worldId: "1037", observeDurationSeconds: 120, observeIntervalSeconds: 1, seedClear: true, notificationsEnabled: false, notificationsDryRun: true };

for (const clear of [true, false]) {
  test(`seeds selected real guilds under exclusive ownership; clear=${clear}`, async () => {
    const calls: string[] = [];
    const updatedAt = new Date("2026-06-10T12:00:00Z");
    const result = await runPhase6SeedDummyGuildKoTotals({ ...baseConfig, seedClear: clear }, {} as Firestore, {
      fetchLatestLocalGvg: async () => createLocalGvgLatest(), now: () => updatedAt,
      createStore: () => ({
        acquire: async () => { calls.push("acquire"); return { ownerId: "test", fenceToken: 1, validUntil: 1e9 }; },
        seed: async (_lease, totals, shouldClear, startedAt) => {
          calls.push("seed"); assert.equal(shouldClear, clear); assert.equal(startedAt, updatedAt);
          assert.deepEqual([...totals.keys()], ["1037001", "1037002", "1037003", "1037004", "1037005"]);
          assert.deepEqual([...totals.values()].map((total) => total.totalVictimKoCount), [12, 7, 3, 0, 5]);
          return clear ? 2 : 0;
        },
        release: async () => { calls.push("release"); },
      }),
    });
    assert.deepEqual(calls, ["acquire", "seed", "release"]);
    assert.deepEqual(result, { fetchedGuildCount: 6, selectedGuildCount: 5, clearedGuildKoTotalsCount: clear ? 2 : 0, writtenGuildKoTotalsCount: 5 });
  });
}

test("does not seed when another run owns the public views", async () => {
  let wrote = false;
  await assert.rejects(runPhase6SeedDummyGuildKoTotals(baseConfig, {} as Firestore, {
    fetchLatestLocalGvg: async () => createLocalGvgLatest(),
    createStore: () => ({ acquire: async () => { throw new Error("already active"); }, seed: async () => { wrote = true; return 0; }, release: async () => {} }),
  }), /already active/);
  assert.equal(wrote, false);
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
