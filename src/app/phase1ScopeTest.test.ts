import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { runPhase1ScopeTest } from "./phase1ScopeTest.js";
import type { AppConfig } from "./config.js";
import type { Phase1ScopeTestViewSnapshot } from "../firestore/koObserverViewRepository.js";
import type { ActiveGuilds } from "../koo/activeGuildExtractor.js";
import type { LocalGvgLatest } from "../mentemori/types.js";

const baseConfig: AppConfig = {
  firebaseProjectId: "project",
  firebaseClientEmail: "client@example.com",
  firebasePrivateKey: "private-key",
  mode: "phase1-scope-test",
  runId: "local",
  worldId: "1001",
  observeDurationSeconds: 120,
  observeIntervalSeconds: 1,
  seedClear: true,
};

test("does not write Firestore when API fetch fails", async () => {
  let writeCalled = false;

  await assert.rejects(() =>
    runPhase1ScopeTest(baseConfig, {} as Firestore, {
      fetchLatestLocalGvg: async () => {
        throw new Error("API failure");
      },
      writePhase1ScopeTestView: async () => {
        writeCalled = true;
      },
    }),
  );

  assert.equal(writeCalled, false);
});

test("writes when previous view does not exist", async () => {
  let writtenActiveGuildCount = 0;
  let writtenPersistReasons: string[] = [];
  let writtenObservationDiffExists = false;

  const result = await runPhase1ScopeTest(baseConfig, {} as Firestore, {
    now: () => new Date("2026-06-07T12:00:30.000Z"),
    fetchLatestLocalGvg: async () => createLocalGvgLatest(0),
    readPhase1ScopeTestView: async () => undefined,
    writePhase1ScopeTestView: async (_firestore, input) => {
      writtenActiveGuildCount = Object.keys(input.activeGuilds).length;
      writtenPersistReasons = input.phase3?.persistReasons ?? [];
      writtenObservationDiffExists =
        input.activeGuilds["1"]?.castles.defending[0]?.observationDiff !== undefined;
    },
  });

  assert.equal(writtenActiveGuildCount, 1);
  assert.deepEqual(writtenPersistReasons, ["checkpoint_elapsed"]);
  assert.equal(writtenObservationDiffExists, true);
  assert.equal(result.shouldPersist, true);
  assert.deepEqual(result.persistReasons, ["checkpoint_elapsed"]);
  assert.equal(result.activeGuildCount, 1);
  assert.equal(result.localGvgCastleCount, 1);
});

test("does not write when only count increased before checkpoint", async () => {
  let writeCalled = false;

  const result = await runPhase1ScopeTest(baseConfig, {} as Firestore, {
    now: () => new Date("2026-06-07T12:00:10.000Z"),
    fetchLatestLocalGvg: async () => createLocalGvgLatest(1),
    readPhase1ScopeTestView: async () =>
      createPreviousView({
        observedAt: "2026-06-07T12:00:00.000Z",
        count: 0,
      }),
    writePhase1ScopeTestView: async () => {
      writeCalled = true;
    },
  });

  assert.equal(writeCalled, false);
  assert.equal(result.shouldPersist, false);
  assert.deepEqual(result.persistReasons, []);
});

test("writes phase3 metadata and observation diff when state changed", async () => {
  let writtenShouldPersist = false;
  let writtenPersistReasons: string[] = [];
  let writtenCountDelta: number | undefined;

  await runPhase1ScopeTest(baseConfig, {} as Firestore, {
    now: () => new Date("2026-06-07T12:00:10.000Z"),
    fetchLatestLocalGvg: async () => ({
      ...createLocalGvgLatest(0),
      castles: [
        {
          CastleId: 1,
          GuildId: 1,
          AttackerGuildId: 0,
          DefensePartyCount: 120,
          GvgCastleState: 2,
          LastWinPartyKnockOutCount: 0,
        },
      ],
    }),
    readPhase1ScopeTestView: async () =>
      createPreviousView({
        observedAt: "2026-06-07T12:00:00.000Z",
        count: 0,
        gvgCastleState: 1,
      }),
    writePhase1ScopeTestView: async (_firestore, input) => {
      writtenShouldPersist = input.phase3?.shouldPersist ?? false;
      writtenPersistReasons = input.phase3?.persistReasons ?? [];
      writtenCountDelta =
        input.activeGuilds["1"]?.castles.defending[0]?.observationDiff?.countDelta;
    },
  });

  assert.equal(writtenShouldPersist, true);
  assert.deepEqual(writtenPersistReasons, ["state_changed"]);
  assert.equal(writtenCountDelta, 0);
});

function createLocalGvgLatest(count: number): LocalGvgLatest {
  return {
    worldId: 1001,
    guilds: {
      "1": "Defender",
    },
    castles: [
      {
        CastleId: 1,
        GuildId: 1,
        AttackerGuildId: 0,
        DefensePartyCount: 120,
        GvgCastleState: 1,
        LastWinPartyKnockOutCount: count,
      },
    ],
  };
}

function createPreviousView(input: {
  observedAt: string;
  count: number;
  gvgCastleState?: 1 | 2;
}): Phase1ScopeTestViewSnapshot {
  return {
    updatedAt: input.observedAt,
    phase3: {
      observedAt: input.observedAt,
      shouldPersist: true,
      persistReasons: ["checkpoint_elapsed"],
      checkpointSeconds: 30,
    },
    activeGuilds: createPreviousActiveGuilds(input.count, input.gvgCastleState ?? 1),
  };
}

function createPreviousActiveGuilds(count: number, gvgCastleState: 1 | 2): ActiveGuilds {
  return {
    "1": {
      guildId: "1",
      guildName: "Defender",
      role: "defender",
      castles: {
        defending: [
          {
            castleId: 1,
            gvgCastleState,
            rawLastWinPartyKnockOutCount: count,
            lastWinPartyDefeatedCount: count,
          },
        ],
        attacking: [],
      },
    },
  };
}
