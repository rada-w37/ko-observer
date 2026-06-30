import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
  AsyncNotificationCoordinator,
  NoopNotificationCoordinator,
} from "./notificationCoordinator.js";
import type {
  NotificationObservation,
  NotificationRequest,
  NotificationRule,
} from "../domain/notificationDomain.js";

test("observe enqueues request creation without awaiting it", async () => {
  const deferred = createDeferred<void>();
  const createdRequestIds: string[] = [];
  const coordinator = new AsyncNotificationCoordinator({
    rules: [createRule()],
    dryRun: false,
    createRequest: async (requestId) => {
      createdRequestIds.push(requestId);
      await deferred.promise;
      return { status: "created" };
    },
    logger: createLogger(),
  });

  coordinator.observe(createObservation());

  assert.equal(createdRequestIds.length, 1);
  const pending = await coordinator.flush({ timeoutMs: 1 });
  assert.equal(pending.timedOut, true);

  deferred.resolve();
  const flushed = await coordinator.flush({ timeoutMs: 100 });
  assert.equal(flushed.timedOut, false);
  assert.equal(flushed.createdCount, 1);
});

test("deduplicates matched requests with seenRequestIds before create", async () => {
  let createCount = 0;
  const coordinator = new AsyncNotificationCoordinator({
    rules: [createRule()],
    dryRun: false,
    createRequest: async () => {
      createCount += 1;
      return { status: "created" };
    },
    logger: createLogger(),
  });

  coordinator.observe(createObservation());
  coordinator.observe(createObservation());
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.equal(createCount, 1);
  assert.equal(flushed.skippedCount, 1);
});

test("dry-run uses only first unseen candidate by priority", async () => {
  let createCount = 0;
  const infos: string[] = [];
  const coordinator = new AsyncNotificationCoordinator({
    rules: [
      createRule({ id: "rule-a", schedule: { startTime: "20:50", endTime: null } }),
      createRule({ id: "rule-b", schedule: { startTime: "21:00", endTime: null } }),
    ],
    dryRun: true,
    createRequest: async () => {
      createCount += 1;
      return { status: "created" };
    },
    logger: createLogger([], infos),
  });

  coordinator.observe(createObservation({ observedAt: new Date("2026-06-17T12:05:00.000Z") }));
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.equal(createCount, 0);
  assert.equal(flushed.dryRunCount, 1);
  assert.equal(infos.some((message) => message.includes("ruleId=rule-b")), true);
});

test("falls back to next candidate only when Firestore reports duplicate", async () => {
  const createdRuleIds: string[] = [];
  const coordinator = new AsyncNotificationCoordinator({
    rules: [
      createRule({ id: "rule-a", sortOrder: 1 }),
      createRule({ id: "rule-b", sortOrder: 2 }),
    ],
    dryRun: false,
    createRequest: async (_requestId, request) => {
      createdRuleIds.push(request.ruleId);
      return createdRuleIds.length === 1 ? { status: "duplicate" } : { status: "created" };
    },
    logger: createLogger(),
  });

  coordinator.observe(createObservation());
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.deepEqual(createdRuleIds, ["rule-a", "rule-b"]);
  assert.equal(flushed.duplicateCount, 1);
  assert.equal(flushed.createdCount, 1);
});

test("does not fall back when Firestore create fails with non-duplicate error", async () => {
  const warnings: string[] = [];
  const createdRuleIds: string[] = [];
  const coordinator = new AsyncNotificationCoordinator({
    rules: [
      createRule({ id: "rule-a", sortOrder: 1 }),
      createRule({ id: "rule-b", sortOrder: 2 }),
    ],
    dryRun: false,
    createRequest: async (_requestId, request) => {
      createdRuleIds.push(request.ruleId);
      throw new Error("firestore unavailable");
    },
    logger: createLogger(warnings),
  });

  assert.doesNotThrow(() => coordinator.observe(createObservation()));
  const flushed = await coordinator.flush({ timeoutMs: 100 });
  await sleep(0);

  assert.deepEqual(createdRuleIds, ["rule-a"]);
  assert.equal(flushed.failedCount, 1);
  assert.equal(warnings.some((message) => message.includes("firestore unavailable")), true);
});

test("skips enqueue when queue limit is reached", async () => {
  const deferred = createDeferred<void>();
  let createCount = 0;
  const coordinator = new AsyncNotificationCoordinator({
    rules: [createRule()],
    dryRun: false,
    maxQueueSize: 1,
    createRequest: async () => {
      createCount += 1;
      await deferred.promise;
      return { status: "created" };
    },
    logger: createLogger(),
  });

  coordinator.observe(createObservation());
  coordinator.observe(createObservation({ castleId: 2, castleName: "モダーヴ" }));
  const timeoutResult = await coordinator.flush({ timeoutMs: 1 });
  assert.equal(timeoutResult.timedOut, true);
  assert.equal(createCount, 1);
  assert.equal(timeoutResult.skippedCount, 1);

  deferred.resolve();
  await coordinator.flush({ timeoutMs: 100 });
});

test("noop coordinator is safe", async () => {
  const coordinator = new NoopNotificationCoordinator();

  assert.doesNotThrow(() => coordinator.observe(createObservation()));
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

function createRule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "rule-a",
    schemaVersion: 2,
    battleType: "guildBattle",
    battleSide: "defense",
    name: "Rule A",
    enabled: true,
    sortOrder: 1,
    schedule: {
      startTime: "20:50",
      endTime: null,
    },
    targetGuildIds: [],
    detailConditions: {
      operator: "OR",
      children: [
        {
          type: "condition",
          field: "defenseCount",
          operator: "<=",
          value: 999,
        },
      ],
    },
    message: {
      usernameTemplate: "KOO",
      mention: { type: "none" },
      titleTemplate: "{諡轤ｹ蜷閤",
      bodyTemplate: "{髦ｲ蠕｡謨ｰ}",
    },
    ...overrides,
  };
}

function createObservation(
  overrides: Partial<NotificationObservation> = {},
): NotificationObservation {
  return {
    guildId: "111111111001",
    battleType: "guildBattle",
    castleId: 1,
    castleName: "ブラッセル",
    ownerGuildId: "111111111001",
    attackerGuildId: "222222222001",
    attackerGuildName: "Attacker A",
    defenseCount: 2,
    attackCount: 5,
    observedAt: new Date("2026-06-17T11:55:00.000Z"),
    worldId: "1001",
    runId: "run-a",
    ...overrides,
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return {
    promise,
    resolve,
  };
}

function createLogger(
  warnings: string[] = [],
  infos: string[] = [],
): {
  info: (message: string) => void;
  warn: (message: string) => void;
} {
  return {
    info: (message: string) => {
      infos.push(message);
    },
    warn: (message: string) => {
      warnings.push(message);
    },
  };
}
