import { loadConfig } from "./config.js";
import { createFirestore } from "../firestore/admin.js";
import { writePhase0SmokeTestView } from "../firestore/koObserverViewRepository.js";
import { logger } from "../shared/logger.js";

async function main(): Promise<void> {
  logger.info("KOO Phase0 smoke test started.");

  const config = loadConfig();
  const firestore = createFirestore(config);

  await writePhase0SmokeTestView(firestore, {
    battleDate: getJstDateString(new Date()),
    runId: config.runId,
  });

  logger.info("KOO Phase0 smoke test completed.");
}

function getJstDateString(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(date);
}

main().catch((error: unknown) => {
  logger.error("KOO Phase0 smoke test failed.", error);
  process.exitCode = 1;
});
