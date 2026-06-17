import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { createNotificationCoordinator } from "./createNotificationCoordinator.js";

test("does not read notification rules when notifications are disabled", async () => {
  const firestore = {
    collection: () => {
      throw new Error("Firestore should not be read");
    },
  } as unknown as Firestore;

  const coordinator = await createNotificationCoordinator({
    firestore,
    config: {
      notificationsEnabled: false,
      notificationsDryRun: true,
    },
    guildId: "guild-a",
  });

  assert.doesNotThrow(() =>
    coordinator.observe({
      guildId: "guild-a",
      battleType: "guildBattle",
      castleId: 1,
      baseName: "拠点1",
      attackerGuildId: null,
      attackerGuildName: null,
      defenseCount: 1,
      attackCount: 1,
      observedAt: new Date("2026-06-17T11:55:00.000Z"),
      worldId: "1001",
      runId: "run-a",
    }),
  );
});

test("does not read notification rules when guildId is unresolved", async () => {
  const firestore = {
    collection: () => {
      throw new Error("Firestore should not be read");
    },
  } as unknown as Firestore;

  const coordinator = await createNotificationCoordinator({
    firestore,
    config: {
      notificationsEnabled: true,
      notificationsDryRun: true,
    },
    guildId: null,
  });

  assert.deepEqual(await coordinator.flush({ timeoutMs: 1 }), {
    timedOut: false,
    pendingCount: 0,
    createdCount: 0,
    duplicateCount: 0,
    dryRunCount: 0,
    skippedCount: 0,
    failedCount: 0,
  });
});
