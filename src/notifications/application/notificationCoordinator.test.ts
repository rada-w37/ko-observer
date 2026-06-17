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

test("deduplicates matched requests with seenRequestIds", async () => {
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

test("dry-run evaluates but does not create requests", async () => {
  let createCount = 0;
  const coordinator = new AsyncNotificationCoordinator({
    rules: [createRule()],
    dryRun: true,
    createRequest: async () => {
      createCount += 1;
      return { status: "created" };
    },
    logger: createLogger(),
  });

  coordinator.observe(createObservation());
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.equal(createCount, 0);
  assert.equal(flushed.dryRunCount, 1);
});

test("catches request creation failures inside queued task", async () => {
  const warnings: string[] = [];
  const coordinator = new AsyncNotificationCoordinator({
    rules: [createRule()],
    dryRun: false,
    createRequest: async () => {
      throw new Error("firestore unavailable");
    },
    logger: createLogger(warnings),
  });

  assert.doesNotThrow(() => coordinator.observe(createObservation()));
  const flushed = await coordinator.flush({ timeoutMs: 100 });
  await sleep(0);

  assert.equal(flushed.failedCount, 1);
  assert.equal(warnings.some((message) => message.includes("firestore unavailable")), true);
});

test("skips enqueue when queue limit is reached", async () => {
  const deferred = createDeferred<void>();
  let createCount = 0;
  const coordinator = new AsyncNotificationCoordinator({
    rules: [createRule(), createRule({ id: "rule-b" })],
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
    battleType: "guildBattle",
    name: "Rule A",
    enabled: true,
    conditions: {
      startTime: "20:50",
      defenseCountMax: null,
      attackCountMin: null,
    },
    message: {
      usernameTemplate: "KOO",
      mention: { type: "none" },
      titleTemplate: "{拠点名}",
      bodyTemplate: "{防御数}",
    },
    ...overrides,
  };
}

function createObservation(): NotificationObservation {
  return {
    guildId: "111111111001",
    battleType: "guildBattle",
    castleId: 1,
    baseName: "拠点1",
    attackerGuildId: "222222222001",
    attackerGuildName: "Attacker A",
    defenseCount: 2,
    attackCount: 5,
    observedAt: new Date("2026-06-17T11:55:00.000Z"),
    worldId: "1001",
    runId: "run-a",
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

function createLogger(warnings: string[] = []): {
  info: () => void;
  warn: (message: string) => void;
} {
  return {
    info: () => {},
    warn: (message: string) => {
      warnings.push(message);
    },
  };
}
