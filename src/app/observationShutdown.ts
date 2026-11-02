import { writeSync } from "node:fs";
import { observationPolicy } from "./observationPolicy.js";

export async function runWithObservationShutdown(
  operation: (signal: AbortSignal) => Promise<void>,
  close: () => Promise<void>,
  durationMs: number,
  shutdownMs: number = observationPolicy.shutdownTimeoutMs,
): Promise<void> {
  const controller = new AbortController();
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  const armShutdown = () => {
    shutdownTimer ??= setTimeout(() => {
      writeSync(2, "[ERROR] Observation cleanup exceeded its deadline; terminating with failure.\n");
      process.exit(1);
    }, shutdownMs);
  };
  const cancel = () => { controller.abort("cancelled"); armShutdown(); };
  const durationTimer = setTimeout(() => { controller.abort("duration reached"); armShutdown(); }, durationMs);
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try { await operation(controller.signal); }
  finally {
    clearTimeout(durationTimer);
    armShutdown();
    try { await close(); }
    finally {
      clearTimeout(shutdownTimer);
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    }
  }
}
