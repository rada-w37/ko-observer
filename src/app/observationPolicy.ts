export const observationPolicy = {
  connectTimeoutMs: 10_000, firstCastleTimeoutMs: 30_000,
  pingIntervalMs: 30_000, pongTimeoutMs: 10_000, stableConnectionMs: 60_000,
  maxReconnectDelayMs: 30_000, publishIntervalMs: 5_000, operationTimeoutMs: 30_000,
  renewIntervalMs: 20_000, progressIntervalMs: 30_000, shutdownTimeoutMs: 10_000, tickMs: 50,
} as const;
export type ObservationPolicy = { [K in keyof typeof observationPolicy]: number };

export async function withinDeadline<T>(operation: Promise<T>, milliseconds: number, label: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), Math.max(0, milliseconds));
      onAbort = () => reject(new Error(`${label} cancelled`));
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    })]);
  } finally { clearTimeout(timer!); if (onAbort) signal?.removeEventListener("abort", onAbort); }
}
