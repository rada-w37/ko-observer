import { performance } from "node:perf_hooks";
import { getJstDateString } from "./date.js";
import { createObservationIdentity, type ObservationLease, type ObservationRunStore } from "../koo/observationRun.js";
import { GvgRealtimeClient } from "../mentemori/realtimeClient.js";
import type { NotificationCoordinator } from "../notifications/application/notificationCoordinator.js";
import { MonitoringSession, type MonitoringResult } from "./monitoringSession.js";
import { KoObservationProcessor, type ActiveBattleScope } from "./koObservationProcessor.js";
import { SnapshotPublisher } from "./snapshotPublisher.js";
import { observationPolicy, withinDeadline, type ObservationPolicy } from "./observationPolicy.js";

type RuntimeOptions = {
  scope: ActiveBattleScope; payload: Uint8Array; store: ObservationRunStore;
  notifications: NotificationCoordinator; runId: string; durationMs: number;
  signal?: AbortSignal; policy?: ObservationPolicy; now?: () => Date;
  monotonicNow?: () => number; sleep?: (ms: number) => Promise<void>;
  createClient?: () => GvgRealtimeClient; log: (message: string) => void;
};

export class ObservationRuntime {
  private lease?: ObservationLease;
  private publisher?: SnapshotPublisher;
  private processor?: KoObservationProcessor;
  private session?: MonitoringSession;
  private renewing = false;
  private renewalError?: unknown;
  private lastRenewAt = 0;
  private lastOfferAt = 0;
  private stopping = false;
  private readonly backgroundStop = new AbortController();
  private readonly policy;
  private readonly monotonicNow;
  private readonly now;

  constructor(private readonly options: RuntimeOptions) {
    this.policy = options.policy ?? observationPolicy;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.now = options.now ?? (() => new Date());
  }

  async run(): Promise<MonitoringResult> {
    const deadline = this.monotonicNow() + this.options.durationMs;
    let result: MonitoringResult | undefined;
    let failure: unknown;
    try {
      this.ensureStartupNotCancelled();
      const resumed = await this.initialize();
      this.ensureStartupNotCancelled();
      const session = new MonitoringSession({
        payload: this.options.payload, durationMs: Math.max(0, deadline - this.monotonicNow()),
        createClient: this.options.createClient ?? (() => new GvgRealtimeClient({
          connectTimeoutMs: this.policy.connectTimeoutMs, pingIntervalMs: this.policy.pingIntervalMs, pongTimeoutMs: this.policy.pongTimeoutMs,
        })),
        onEpoch: () => this.processor!.accumulator.beginObservationEpoch(),
        onPayload: (payload, receivedAt) => this.processor!.process(payload, receivedAt),
        onTick: () => this.tick(), onProgress: () => `${this.processor!.progress} committedRevision=${this.publisher!.status.committedRevision}`,
        log: (message) => this.log(message), signal: this.options.signal, policy: this.policy,
        monotonicNow: this.monotonicNow, now: this.now, sleep: this.options.sleep, resumed,
      });
      this.session = session;
      this.processor!.ruleTick(this.now());
      result = await session.run();
    } catch (error) { failure = error; }
    try {
      await withinDeadline(this.finalize(), this.policy.shutdownTimeoutMs, "Observation cleanup");
    } catch (error) {
      this.log(`Observation cleanup failed error=${JSON.stringify(error instanceof Error
        ? { name: error.name, message: error.message, code: (error as { code?: string | number }).code }
        : { message: String(error) })}`);
      failure ??= error;
    }
    finally { this.stopping = true; this.publisher?.close(); }
    this.log(`summary outcome=${failure ? "failed" : result?.outcome} received=${this.session?.counts.receivedCount ?? 0} reconnects=${this.session?.counts.reconnectCount ?? 0} ${this.processor?.progress ?? ""} committedRevision=${this.publisher?.status.committedRevision ?? 0}`);
    if (failure) throw failure;
    return result!;
  }

  private async initialize(): Promise<boolean> {
    this.lease = await withinDeadline(this.options.store.acquire(), this.policy.operationTimeoutMs, "Acquire observation ownership");
    this.ensureStartupNotCancelled();
    this.lastRenewAt = this.monotonicNow();
    const scope = this.options.scope;
    const participants = scope.subscriptionType === "grandBattle"
      ? Object.fromEntries(scope.participantGuilds.map((guild) => [guild.guildId, guild.guildName])) : {};
    const streamId = new DataView(this.options.payload.buffer, this.options.payload.byteOffset, this.options.payload.byteLength).getUint32(0, true);
    const identity = createObservationIdentity(getJstDateString(this.now()), scope.battleType, streamId);
    const { checkpoint, resumed } = await withinDeadline(
      this.options.store.resume(this.lease, identity, participants, this.now()), this.policy.operationTimeoutMs, "Resume observation",
    );
    this.ensureStartupNotCancelled();
    this.processor = new KoObservationProcessor(scope, checkpoint, this.options.notifications, this.options.runId, (message) => this.log(message));
    this.publisher = new SnapshotPublisher(checkpoint.accumulator.revision,
      (snapshot, castleIds, publishTotals) => this.options.store.commit(this.lease!, snapshot, castleIds, publishTotals),
      this.monotonicNow, this.policy.operationTimeoutMs, (message) => this.log(message));
    this.lastOfferAt = this.monotonicNow();
    this.log(`session=${identity.sessionId} resumed=${resumed} revision=${checkpoint.accumulator.revision}${resumed ? " observation gap: process restarted; missing data will not be restored" : ""}`);
    return resumed;
  }

  private tick(): void {
    if (this.renewalError) throw this.renewalError;
    if (this.monotonicNow() >= this.lease!.validUntil) throw new Error("Local observation ownership deadline expired.");
    if (!this.renewing && this.monotonicNow() - this.lastRenewAt >= this.policy.renewIntervalMs) {
      this.renewing = true;
      this.lastRenewAt = this.monotonicNow();
      void withinDeadline(this.options.store.renew(this.lease!), this.policy.operationTimeoutMs, "Renew ownership", this.backgroundStop.signal)
        .then((lease) => { if (!this.stopping) this.lease = lease; })
        .catch((error: unknown) => { this.renewalError = error; })
        .finally(() => { this.renewing = false; });
    }
    if (this.processor!.needsImmediateSave || this.monotonicNow() - this.lastOfferAt >= this.policy.publishIntervalMs) this.offer();
    this.publisher!.tick();
  }

  private offer(): void {
    const publication = this.processor!.takePublication(this.now());
    this.publisher!.offer(publication.checkpoint, publication.castleIds, publication.publishTotals);
    this.lastOfferAt = this.monotonicNow();
  }

  private async finalize(): Promise<void> {
    this.stopping = true;
    this.backgroundStop.abort();
    try {
      if (this.processor && this.publisher && this.monotonicNow() < this.lease!.validUntil && !this.renewalError) {
        this.offer();
        await this.publisher.flush(this.policy.shutdownTimeoutMs);
      }
      if (this.lease) await this.options.store.release(this.lease);
    } finally {
      this.stopping = true;
      this.publisher?.close();
      try { await this.options.notifications.flush({ timeoutMs: Math.min(5000, this.policy.shutdownTimeoutMs) }); }
      catch (error) { this.log(`Notification flush failed: ${String(error)}`); }
    }
  }

  private log(message: string): void { this.options.log(`${this.now().toISOString()} ${message}`); }

  private ensureStartupNotCancelled(): void {
    if (this.options.signal?.aborted) throw new Error("Observation cancelled before startup.");
  }
}
