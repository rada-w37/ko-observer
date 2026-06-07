import { loadConfig } from "./config.js";
import { getJstDateString } from "./date.js";
import { runPhase1ScopeTest } from "./phase1ScopeTest.js";
import { createFirestore } from "../firestore/admin.js";
import { writePhase0SmokeTestView } from "../firestore/koObserverViewRepository.js";
import { logger } from "../shared/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const firestore = createFirestore(config);

  logger.info(`KOO started. mode=${config.mode}`);

  if (config.mode === "phase1-scope-test") {
    await runPhase1ScopeTest(config, firestore);
    logger.info(`KOO Phase1 scope test completed. worldId=${config.worldId}`);
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
