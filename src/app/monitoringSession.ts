import { performance } from "node:perf_hooks";
import type { GvgRealtimeClient, GvgRealtimeClientEvent } from "../mentemori/realtimeClient.js";
import type { RealtimePayloadBytes } from "../mentemori/realtimeParser.js";
import { observationPolicy, type ObservationPolicy } from "./observationPolicy.js";

export type MonitoringResult = { outcome: "completed" | "completed_with_gaps"; receivedCount: number; reconnectCount: number };
type Connection = { client: GvgRealtimeClient; unsubscribe: () => void; subscribedAt?: number; firstCastleAt?: number };
type SessionOptions = {
  payload: Uint8Array;
  durationMs: number;
  createClient: () => GvgRealtimeClient;
  onEpoch: () => void;
  onPayload: (payload: RealtimePayloadBytes, receivedAt: Date) => { castleReceived: boolean; reconnect?: boolean };
  onTick: () => void;
  onProgress: () => string;
  log: (message: string) => void;
  signal?: AbortSignal;
  policy?: ObservationPolicy;
  monotonicNow?: () => number;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  resumed?: boolean;
};

export class MonitoringSession {
  private connection?: Connection;
  private nextConnectAt = 0;
  private attempts = 0;
  private receivedCount = 0;
  private reconnectCount = 0;
  private hadGap: boolean;
  private fatal?: Error;
  private running = false;
  private readonly policy;
  private readonly monotonicNow;
  private readonly now;

  constructor(private readonly options: SessionOptions) {
    this.policy = options.policy ?? observationPolicy;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.now = options.now ?? (() => new Date());
    this.hadGap = options.resumed ?? false;
  }

  get counts(): { receivedCount: number; reconnectCount: number } {
    return { receivedCount: this.receivedCount, reconnectCount: this.reconnectCount };
  }

  async run(): Promise<MonitoringResult> {
    const end = this.monotonicNow() + this.options.durationMs;
    let nextProgressAt = this.monotonicNow() + this.policy.progressIntervalMs;
    this.running = true;
    try {
      while (this.monotonicNow() < end) {
        if (this.options.signal?.aborted) {
          if (this.options.signal.reason === "duration reached") break;
          throw new Error("Observation cancelled.");
        }
        if (this.fatal) throw this.fatal;
        const connection = this.connection;
        if (!connection && this.monotonicNow() >= this.nextConnectAt) this.startConnection();
        if (connection?.subscribedAt !== undefined && connection.firstCastleAt === undefined &&
            this.monotonicNow() - connection.subscribedAt >= this.policy.firstCastleTimeoutMs) {
          this.dropConnection(connection, "first castle data timed out");
        }
        if (connection?.firstCastleAt !== undefined && this.monotonicNow() - connection.firstCastleAt >= this.policy.stableConnectionMs) this.attempts = 0;
        this.options.onTick();
        if (this.monotonicNow() >= nextProgressAt) {
          this.options.log(`progress received=${this.receivedCount} reconnects=${this.reconnectCount} ${this.options.onProgress()}`);
          nextProgressAt = this.monotonicNow() + this.policy.progressIntervalMs;
        }
        await (this.options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(this.policy.tickMs);
      }
      if (this.fatal) throw this.fatal;
      if (this.connection?.firstCastleAt === undefined) throw new Error("Observation ended without a synchronized connection.");
      return { outcome: this.hadGap ? "completed_with_gaps" : "completed", receivedCount: this.receivedCount, reconnectCount: this.reconnectCount };
    } finally {
      this.running = false;
      const connection = this.connection;
      this.connection = undefined;
      connection?.unsubscribe();
      connection?.client.disconnect("observation stopped");
    }
  }

  private startConnection(): void {
    const client = this.options.createClient();
    const connection: Connection = { client, unsubscribe: () => {} };
    this.connection = connection;
    this.options.onEpoch();
    connection.unsubscribe = client.addEventListener((event) => this.receive(connection, event));
    void client.connect({ payload: this.options.payload }).then(() => {
      if (this.connection === connection && this.running) connection.subscribedAt = this.monotonicNow();
    }).catch((error: unknown) => this.dropConnection(connection, String(error)));
  }

  private receive(connection: Connection, event: GvgRealtimeClientEvent): void {
    if (!this.running || this.connection !== connection) return;
    if (event.type === "disconnected" || event.type === "error") {
      this.dropConnection(connection, event.type === "error" ? event.error.message : `${event.reason} code=${event.code ?? "unknown"}`);
    } else if (event.type === "payloadReceived") {
      this.receivedCount += 1;
      try {
        const result = this.options.onPayload(event.payload, this.now());
        if (result.reconnect) { this.dropConnection(connection, "invalid payload; rebaseline required"); return; }
        if (result.castleReceived && connection.firstCastleAt === undefined) {
          connection.firstCastleAt = this.monotonicNow();
          this.options.log(`observation synchronized reconnects=${this.reconnectCount}`);
        }
      } catch (error) { this.fatal = error instanceof Error ? error : new Error(String(error)); }
    }
  }

  private dropConnection(connection: Connection, reason: string): void {
    if (!this.running || this.connection !== connection) return;
    this.connection = undefined;
    connection.unsubscribe();
    connection.client.disconnect(reason);
    this.hadGap = true;
    this.reconnectCount += 1;
    const base = Math.min(1000 * 2 ** Math.min(this.attempts++, 5), this.policy.maxReconnectDelayMs);
    const delay = Math.min(base * (1 + (this.options.random ?? Math.random)() * 0.2), this.policy.maxReconnectDelayMs);
    this.nextConnectAt = this.monotonicNow() + delay;
    this.options.log(`observation gap reason=${reason} retryAfterMs=${Math.round(delay)}`);
  }
}
