import type { Firestore } from "firebase-admin/firestore";
import type { AppConfig } from "./config.js";
import { runPhase1ScopeTest, type RunPhase1ScopeTestResult } from "./phase1ScopeTest.js";
import { logger } from "../shared/logger.js";

type RunObserveLoopDependencies = {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  runPhase1ScopeTest?: (
    config: AppConfig,
    firestore: Firestore,
  ) => Promise<RunPhase1ScopeTestResult>;
};

export async function runObserveLoop(
  config: AppConfig,
  firestore: Firestore,
  dependencies: RunObserveLoopDependencies = {},
): Promise<void> {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? sleepMilliseconds;
  const runScopeTest = dependencies.runPhase1ScopeTest ?? runPhase1ScopeTest;
  const startedAt = now();
  const endAt = startedAt + config.observeDurationSeconds * 1000;
  const intervalMilliseconds = config.observeIntervalSeconds * 1000;
  let iteration = 0;

  logger.info(
    `observe loop started durationSeconds=${config.observeDurationSeconds} intervalSeconds=${config.observeIntervalSeconds}`,
  );

  while (now() < endAt) {
    iteration += 1;
    const iterationStartedAt = now();
    logger.info(`observe iteration=${iteration}`);

    try {
      const result = await runScopeTest(config, firestore);
      if (result.shouldPersist) {
        logger.info(`persist saved reasons=${JSON.stringify(result.persistReasons)}`);
      } else {
        logger.info("persist skipped");
      }
    } catch (error) {
      logger.error(`observe iteration=${iteration} failed`, error);
    }

    const elapsedMilliseconds = now() - iterationStartedAt;
    await sleep(Math.max(0, intervalMilliseconds - elapsedMilliseconds));
  }

  logger.info(`observe loop completed iterations=${iteration}`);
}

function sleepMilliseconds(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
