import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { runObserveLoop } from "./observeLoop.js";
import type { AppConfig } from "./config.js";

const baseConfig: AppConfig = {
  firebaseProjectId: "project",
  firebaseClientEmail: "client@example.com",
  firebasePrivateKey: "private-key",
  mode: "phase4-observe-loop",
  runId: "local",
  worldId: "1001",
  observeDurationSeconds: 3,
  observeIntervalSeconds: 1,
  seedClear: true,
};

test("runs multiple iterations until duration is exceeded", async () => {
  let currentTime = 0;
  let runCount = 0;
  const sleeps: number[] = [];

  await runObserveLoop(baseConfig, {} as Firestore, {
    now: () => currentTime,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      currentTime += milliseconds;
    },
    runPhase1ScopeTest: async () => {
      runCount += 1;
      currentTime += 100;
      return createResult(false);
    },
  });

  assert.equal(runCount, 3);
  assert.deepEqual(sleeps, [900, 900, 900]);
});

test("sleeps zero when iteration work exceeds interval", async () => {
  let currentTime = 0;
  const sleeps: number[] = [];

  await runObserveLoop(
    {
      ...baseConfig,
      observeDurationSeconds: 1,
    },
    {} as Firestore,
    {
      now: () => currentTime,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        currentTime += 1000;
      },
      runPhase1ScopeTest: async () => {
        currentTime += 1200;
        return createResult(true);
      },
    },
  );

  assert.deepEqual(sleeps, [0]);
});

test("continues next iteration when one iteration fails", async () => {
  let currentTime = 0;
  let runCount = 0;

  await runObserveLoop(baseConfig, {} as Firestore, {
    now: () => currentTime,
    sleep: async (milliseconds) => {
      currentTime += milliseconds;
    },
    runPhase1ScopeTest: async () => {
      runCount += 1;
      currentTime += 100;
      if (runCount === 1) {
        throw new Error("API failure");
      }
      return createResult(false);
    },
  });

  assert.equal(runCount, 3);
});

function createResult(shouldPersist: boolean) {
  return {
    shouldPersist,
    persistReasons: shouldPersist ? ["checkpoint_elapsed"] : [],
    activeGuildCount: 1,
    localGvgCastleCount: 21,
  };
}
