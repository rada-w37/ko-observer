import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { runPhase1ScopeTest } from "./phase1ScopeTest.js";
import type { AppConfig } from "./config.js";

const baseConfig: AppConfig = {
  firebaseProjectId: "project",
  firebaseClientEmail: "client@example.com",
  firebasePrivateKey: "private-key",
  mode: "phase1-scope-test",
  runId: "local",
  worldId: "w1",
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

test("writes Phase1 scope test view after successful resolution", async () => {
  let writtenWorldId: string | undefined;
  let writtenActiveGuildCount = 0;

  await runPhase1ScopeTest(baseConfig, {} as Firestore, {
    fetchLatestLocalGvg: async () => ({
      castles: [
        {
          gvgCastleState: 1,
          defenderGuild: {
            guildId: "g1",
            guildName: "Defender",
          },
        },
      ],
    }),
    writePhase1ScopeTestView: async (_firestore, input) => {
      writtenWorldId = input.worldId;
      writtenActiveGuildCount = Object.keys(input.activeGuilds).length;
    },
  });

  assert.equal(writtenWorldId, "w1");
  assert.equal(writtenActiveGuildCount, 1);
});
