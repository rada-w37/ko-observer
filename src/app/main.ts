import { loadConfig } from "./config.js";
import { getJstDateString } from "./date.js";
import { runObserveLoop } from "./observeLoop.js";
import { runPhase5KoObserveLoop } from "./phase5KoObserveLoop.js";
import { runPhase1ScopeTest } from "./phase1ScopeTest.js";
import { createFirestore } from "../firestore/admin.js";
import { writePhase0SmokeTestView } from "../firestore/koObserverViewRepository.js";
import { logger } from "../shared/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const firestore = createFirestore(config);

  logger.info(`KOO started. mode=${config.mode}`);

  if (config.mode === "phase1-scope-test") {
    const result = await runPhase1ScopeTest(config, firestore);
    if (result.shouldPersist) {
      logger.info(`persist saved reasons=${JSON.stringify(result.persistReasons)}`);
    } else {
      logger.info("persist skipped");
    }
    logger.info(`KOO Phase1 scope test completed. worldId=${config.worldId}`);
    return;
  }

  if (config.mode === "phase4-observe-loop") {
    await runObserveLoop(config, firestore);
    logger.info(`KOO Phase4 observe loop completed. worldId=${config.worldId}`);
    return;
  }

  if (config.mode === "phase5-ko-observe-loop") {
    await runPhase5KoObserveLoop(config, firestore);
    logger.info(`KOO Phase5 KO observe loop completed. worldId=${config.worldId}`);
    return;
  }

  await writePhase0SmokeTestView(firestore, {
    battleDate: getJstDateString(new Date()),
    runId: config.runId,
  });

  logger.info("KOO Phase0 smoke test completed.");
}

main().catch((error: unknown) => {
  logger.error("KOO failed.", error);
  process.exitCode = 1;
});
