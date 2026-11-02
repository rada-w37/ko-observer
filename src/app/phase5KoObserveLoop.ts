import type { Firestore } from "firebase-admin/firestore";
import type { AppConfig } from "./config.js";
import { performance } from "node:perf_hooks";
import { loadMonitorGuildTargetFromGuildShares } from "../firestore/guildShareRepository.js";
import { ObservationRunRepository } from "../firestore/observationRunRepository.js";
import type { ObservationRunStore } from "../koo/observationRun.js";
import { createNotificationCoordinator } from "../notifications/application/createNotificationCoordinator.js";
import { GvgRealtimeClient } from "../mentemori/realtimeClient.js";
import { createGuildBattleSubscriptionPayload, createGrandBattleSubscriptionPayload } from "../mentemori/streamId.js";
import { resolveBattleSubscriptionScope } from "../koo/battleScopeResolver.js";
import { ObservationRuntime } from "./observationRuntime.js";
import { observationPolicy, withinDeadline, type ObservationPolicy } from "./observationPolicy.js";
import { logger } from "../shared/logger.js";

type Phase5KoObserveLoopDependencies = {
  createRealtimeClient?: () => GvgRealtimeClient;
  createStore?: () => ObservationRunStore;
  resolveBattleSubscriptionScope?: typeof resolveBattleSubscriptionScope;
  loadMonitorGuildTargetFromGuildShares?: typeof loadMonitorGuildTargetFromGuildShares;
  createNotificationCoordinator?: typeof createNotificationCoordinator;
  now?: () => Date;
  monotonicNow?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
  policy?: ObservationPolicy;
};

export async function runPhase5KoObserveLoop(
  config: AppConfig, firestore: Firestore, dependencies: Phase5KoObserveLoopDependencies = {},
): Promise<void> {
  const policy = dependencies.policy ?? observationPolicy;
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const end = monotonicNow() + config.observeDurationSeconds * 1000;
  const setup = <T>(operation: Promise<T>) => withinDeadline(operation, Math.min(policy.operationTimeoutMs, Math.max(0, end - monotonicNow())), "Observation setup");
  const target = config.worldId
    ? { status: "ok" as const, worldId: config.worldId, guildId: config.guildId ?? null, guildName: config.ownGuildName ?? null }
    : await setup((dependencies.loadMonitorGuildTargetFromGuildShares ?? loadMonitorGuildTargetFromGuildShares)(firestore));
  if (target.status !== "ok") { logger.warn(target.message); return; }
  logger.info(`monitor target resolved worldId=${target.worldId} guildId=${target.guildId ?? ""} guildName=${target.guildName ?? ""}`);
  const boundedFetch: typeof fetch = (input, init) => fetch(input, {
    ...init,
    signal: AbortSignal.any([AbortSignal.timeout(policy.connectTimeoutMs), ...(init?.signal ? [init.signal] : []), ...(dependencies.signal ? [dependencies.signal] : [])]),
  });
  const scope = await setup((dependencies.resolveBattleSubscriptionScope ?? resolveBattleSubscriptionScope)(
    { worldId: target.worldId, guildId: target.guildId ?? undefined }, boundedFetch,
  ));
  logger.info(`battle scope resolved battleType=${scope.battleType} subscriptionType=${scope.subscriptionType} worldId=${scope.worldId}`);
  if (scope.subscriptionType === "none") { logger.warn(`Phase5 subscription skipped reason=${scope.reason}`); return; }
  const payload = scope.subscriptionType === "guildBattle" ? createGuildBattleSubscriptionPayload(scope.worldId)
    : createGrandBattleSubscriptionPayload({ worldGroupId: scope.worldGroupId, classId: scope.classId, blockId: scope.blockId });
  const notifications = await setup((dependencies.createNotificationCoordinator ?? createNotificationCoordinator)({ firestore, config, guildId: scope.guildId }));
  const runtime = new ObservationRuntime({ scope, payload, notifications, runId: config.runId,
    durationMs: Math.max(0, end - monotonicNow()),
    store: (dependencies.createStore ?? (() => new ObservationRunRepository(firestore, monotonicNow)))(),
    createClient: dependencies.createRealtimeClient, now: dependencies.now, monotonicNow, sleep: dependencies.sleep,
    signal: dependencies.signal, policy, log: (message) => logger.info(message),
  });
  await runtime.run();
}
