import { ObservationOwnershipError, type ObservationCheckpoint } from "../koo/observationRun.js";

type PublishRequest = { checkpoint: ObservationCheckpoint; castleIds: number[]; publishTotals: boolean };

export class SnapshotPublisher {
  private pending?: PublishRequest;
  private task?: Promise<void>;
  private inFlightSince = 0;
  private nextAttemptAt = 0;
  private failures = 0;
  private failure?: Error;
  private closed = false;
  private committedRevision: number;

  constructor(revision: number,
    private readonly commit: (checkpoint: ObservationCheckpoint, castleIds: number[], publishTotals: boolean) => Promise<void>,
    private readonly now: () => number, private readonly timeoutMs: number, private readonly warn: (message: string) => void,
    private readonly onCommit?: (result: { revision: number; elapsedMs: number; castleIds: number[]; publishTotals: boolean }) => void,
  ) { this.committedRevision = revision; }

  offer(checkpoint: ObservationCheckpoint, castleIds: number[], publishTotals: boolean): void {
    if (this.closed) throw new Error("Publisher is closed.");
    if (checkpoint.accumulator.revision <= this.committedRevision) return;
    const previous = this.pending;
    this.pending = { checkpoint: structuredClone(checkpoint),
      castleIds: [...new Set([...(previous?.castleIds ?? []), ...castleIds])],
      publishTotals: publishTotals || (previous?.publishTotals ?? false) };
  }

  tick(): void {
    if (this.failure) throw this.failure;
    if (this.task && this.now() - this.inFlightSince >= this.timeoutMs) {
      this.failure = new Error("Observation save timed out; outcome may be unknown.");
      throw this.failure;
    }
    if (this.pending && this.pending.checkpoint.accumulator.revision <= this.committedRevision) this.pending = undefined;
    if (this.closed || this.task || !this.pending || this.now() < this.nextAttemptAt) return;
    const request = this.pending;
    this.pending = undefined;
    this.inFlightSince = this.now();
    this.task = Promise.resolve().then(() => this.commit(request.checkpoint, request.castleIds, request.publishTotals))
      .then(() => {
        this.committedRevision = request.checkpoint.accumulator.revision; this.failures = 0;
        this.onCommit?.({ revision: this.committedRevision, elapsedMs: Math.round(this.now() - this.inFlightSince),
          castleIds: request.castleIds, publishTotals: request.publishTotals });
      })
      .catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error));
        const code = (error as { code?: number })?.code;
        if (error instanceof ObservationOwnershipError || ![4, 8, 10, 13, 14].includes(code ?? -1)) { this.failure = failure; return; }
        if (!this.closed) {
          this.offer(this.pending?.checkpoint ?? request.checkpoint, request.castleIds, request.publishTotals);
          this.nextAttemptAt = this.now() + Math.min(1000 * 2 ** Math.min(this.failures++, 5), 30_000);
          this.warn(`Observation save will retry: ${failure.message}`);
        }
      }).finally(() => { this.task = undefined; });
  }

  get status(): { committedRevision: number; pending: boolean } {
    return { committedRevision: this.committedRevision, pending: Boolean(this.pending || this.task) };
  }

  async flush(timeoutMs: number): Promise<void> {
    const end = this.now() + timeoutMs;
    while (this.pending || this.task) {
      if (this.closed) throw new Error("Publisher closed before final save.");
      this.tick();
      if (this.now() >= end) throw new Error("Observation final save timed out.");
      await new Promise((resolve) => setTimeout(resolve, Math.min(10, timeoutMs)));
    }
    this.tick();
  }

  close(): void { this.closed = true; this.pending = undefined; }
}
