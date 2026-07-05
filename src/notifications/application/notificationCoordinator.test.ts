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
  NotificationRuleTick,
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

test("creates one rule-level request for repeated detail-rule-off ticks", async () => {
  const createdRequests: NotificationRequest[] = [];
  const coordinator = new AsyncNotificationCoordinator({
    rules: [createRule({ detailRuleEnabled: false })],
    dryRun: false,
    createRequest: async (_requestId, request) => {
      createdRequests.push(request);
      return { status: "created" };
    },
    logger: createLogger(),
  });

  coordinator.observeRuleTick(createRuleTick());
  coordinator.observeRuleTick(createRuleTick());
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.equal(createdRequests.length, 1);
  assert.equal(flushed.skippedCount, 1);
  assert.equal(createdRequests[0]?.detailRuleEnabled, false);
  assert.equal(
    createdRequests[0]?.duplicateKey,
    "111111111001:guildBattle:1001:2026-06-17:rule-a:time:20:50-open",
  );
});

test("creates separate rule-level requests for separate detail-rule-off rules", async () => {
  const createdRuleIds: string[] = [];
  const coordinator = new AsyncNotificationCoordinator({
    rules: [
      createRule({ id: "rule-a", detailRuleEnabled: false }),
      createRule({ id: "rule-b", detailRuleEnabled: false }),
    ],
    dryRun: false,
    createRequest: async (_requestId, request) => {
      createdRuleIds.push(request.ruleId);
      return { status: "created" };
    },
    logger: createLogger(),
  });

  coordinator.observeRuleTick(createRuleTick());
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.deepEqual(createdRuleIds, ["rule-a", "rule-b"]);
  assert.equal(flushed.createdCount, 2);
});

test("warns and skips detail-rule-off templates with detail-only variables", async () => {
  const warnings: string[] = [];
  let createCount = 0;
  const coordinator = new AsyncNotificationCoordinator({
    rules: [
      createRule({
        detailRuleEnabled: false,
        message: {
          usernameTemplate: "KOO",
          mention: { type: "none" },
          titleTemplate: "{拠点名}",
          bodyTemplate: "{通知ルール名}",
        },
      }),
    ],
    dryRun: false,
    createRequest: async () => {
      createCount += 1;
      return { status: "created" };
    },
    logger: createLogger(warnings),
  });

  coordinator.observeRuleTick(createRuleTick());
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.equal(createCount, 0);
  assert.equal(flushed.createdCount, 0);
  assert.equal(warnings.some((message) => message.includes("detail-only variables")), true);
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

test("creates notification request from Grand Battle observation", async () => {
  const createdRequests: NotificationRequest[] = [];
  const coordinator = new AsyncNotificationCoordinator({
    rules: [createRule({ battleType: "grandBattle" })],
    dryRun: false,
    createRequest: async (_requestId, request) => {
      createdRequests.push(request);
      return { status: "created" };
    },
    logger: createLogger(),
  });

  coordinator.observe(
    createObservation({ battleType: "grandBattle", worldId: "1037", blockId: 2 }),
  );
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.equal(flushed.createdCount, 1);
  assert.equal(createdRequests.length, 1);
  assert.equal(createdRequests[0]?.battleType, "grandBattle");
  assert.equal(createdRequests[0]?.source.blockId, 2);
  assert.equal(
    createdRequests[0]?.duplicateKey,
    "111111111001:grandBattle:1037:2026-06-17:rule-a:castle-1:222222222001",
  );
});

test("uses repeat request path without suppressing later observations by seenRequestIds", async () => {
  let createCount = 0;
  let repeatCreateCount = 0;
  const repeatIntervals: number[] = [];
  const coordinator = new AsyncNotificationCoordinator({
    rules: [createRule({ repeatNotification: { enabled: true, intervalSeconds: 30 } })],
    dryRun: false,
    createRequest: async () => {
      createCount += 1;
      return { status: "created" };
    },
    createRepeatRequest: async (_request, intervalSeconds) => {
      repeatCreateCount += 1;
      repeatIntervals.push(intervalSeconds);
      return { status: "created" };
    },
    logger: createLogger(),
  });

  coordinator.observe(createObservation());
  coordinator.observe(createObservation());
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.equal(createCount, 0);
  assert.equal(repeatCreateCount, 2);
  assert.deepEqual(repeatIntervals, [30, 30]);
  assert.equal(flushed.createdCount, 2);
});

test("counts repeat interval skips without creating a normal notification request", async () => {
  let createCount = 0;
  let repeatCreateCount = 0;
  const coordinator = new AsyncNotificationCoordinator({
    rules: [createRule({ repeatNotification: { enabled: true, intervalSeconds: 60 } })],
    dryRun: false,
    createRequest: async () => {
      createCount += 1;
      return { status: "created" };
    },
    createRepeatRequest: async () => {
      repeatCreateCount += 1;
      return repeatCreateCount === 1 ? { status: "created" } : { status: "skipped" };
    },
    logger: createLogger(),
  });

  coordinator.observe(createObservation());
  coordinator.observe(createObservation());
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.equal(createCount, 0);
  assert.equal(repeatCreateCount, 2);
  assert.equal(flushed.createdCount, 1);
  assert.equal(flushed.skippedCount, 1);
});

test("does not use repeat path for detail-rule-off rules even when repeat is enabled", async () => {
  let createCount = 0;
  let repeatCreateCount = 0;
  const coordinator = new AsyncNotificationCoordinator({
    rules: [
      createRule({
        detailRuleEnabled: false,
        repeatNotification: { enabled: true, intervalSeconds: 60 },
      }),
    ],
    dryRun: false,
    createRequest: async () => {
      createCount += 1;
      return { status: "created" };
    },
    createRepeatRequest: async () => {
      repeatCreateCount += 1;
      return { status: "created" };
    },
    logger: createLogger(),
  });

  coordinator.observeRuleTick(createRuleTick());
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.equal(createCount, 1);
  assert.equal(repeatCreateCount, 0);
  assert.equal(flushed.createdCount, 1);
});

test("does not create repeat notification when detail conditions are not matched", async () => {
  let repeatCreateCount = 0;
  const coordinator = new AsyncNotificationCoordinator({
    rules: [
      createRule({
        detailConditions: {
          operator: "OR",
          children: [{ type: "condition", field: "defenseCount", operator: "<=", value: 1 }],
        },
        repeatNotification: { enabled: true, intervalSeconds: 60 },
      }),
    ],
    dryRun: false,
    createRequest: async () => ({ status: "created" }),
    createRepeatRequest: async () => {
      repeatCreateCount += 1;
      return { status: "created" };
    },
    logger: createLogger(),
  });

  coordinator.observe(createObservation({ defenseCount: 2 }));
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.equal(repeatCreateCount, 0);
  assert.equal(flushed.createdCount, 0);
});

test("falls back to next candidate when repeat notification is skipped by interval", async () => {
  const createdRuleIds: string[] = [];
  const coordinator = new AsyncNotificationCoordinator({
    rules: [
      createRule({
        id: "rule-a",
        sortOrder: 1,
        repeatNotification: { enabled: true, intervalSeconds: 60 },
      }),
      createRule({ id: "rule-b", sortOrder: 2 }),
    ],
    dryRun: false,
    createRequest: async (_requestId, request) => {
      createdRuleIds.push(request.ruleId);
      return { status: "created" };
    },
    createRepeatRequest: async () => ({ status: "skipped" }),
    logger: createLogger(),
  });

  coordinator.observe(createObservation());
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.deepEqual(createdRuleIds, ["rule-b"]);
  assert.equal(flushed.skippedCount, 1);
  assert.equal(flushed.createdCount, 1);
});

test("creates notification request when body and username are empty", async () => {
  const createdRequests: NotificationRequest[] = [];
  const coordinator = new AsyncNotificationCoordinator({
    rules: [
      createRule({
        message: {
          usernameTemplate: "",
          mention: { type: "none" },
          titleTemplate: "{隲｡・ｰ霓､・ｹ陷ｷ髢､",
          bodyTemplate: "",
        },
      }),
    ],
    dryRun: false,
    createRequest: async (_requestId, request) => {
      createdRequests.push(request);
      return { status: "created" };
    },
    logger: createLogger(),
  });

  coordinator.observe(createObservation());
  const flushed = await coordinator.flush({ timeoutMs: 100 });

  assert.equal(flushed.createdCount, 1);
  assert.equal(createdRequests.length, 1);
  assert.equal(createdRequests[0]?.message.username, "");
  assert.equal(createdRequests[0]?.message.body, "");
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
    detailRuleEnabled: true,
    battleSide: "defense",
    name: "Rule A",
    enabled: true,
    sortOrder: 1,
    schedule: {
      startTime: "20:50",
      endTime: null,
    },
    guildFilter: [],
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
    repeatNotification: {
      enabled: false,
      intervalSeconds: 300,
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
    gvgCastleState: 1,
    ownerGuildId: "111111111001",
    ownerGuildName: "Owner A",
    attackerGuildId: "222222222001",
    attackerGuildName: "Attacker A",
    attackGuildId: "222222222001",
    attackGuildName: "Attacker A",
    defenseGuildId: "111111111001",
    defenseGuildName: "Owner A",
    defenseCount: 2,
    attackCount: 5,
    observedAt: new Date("2026-06-17T11:55:00.000Z"),
    worldId: "1001",
    runId: "run-a",
    ...overrides,
  };
}

function createRuleTick(overrides: Partial<NotificationRuleTick> = {}): NotificationRuleTick {
  return {
    guildId: "111111111001",
    battleType: "guildBattle",
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
