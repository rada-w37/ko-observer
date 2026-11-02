import WebSocket from "ws";
import { createGuildBattleSubscriptionPayload } from "./streamId.js";
import { observationPolicy } from "../app/observationPolicy.js";
import type { RealtimePayloadBytes } from "./realtimeParser.js";

export const GVG_REALTIME_WEBSOCKET_ENDPOINT = "wss://api.mentemori.icu/gvg";
export type GvgRealtimeClientEvent =
  | { type: "opened" } | { type: "subscriptionSent" } | { type: "connected" }
  | { type: "disconnected"; reason?: string; code?: number }
  | { type: "payloadReceived"; payload: RealtimePayloadBytes }
  | { type: "error"; error: Error };
export type GvgRealtimeClientListener = (event: GvgRealtimeClientEvent) => void;
export type GvgRealtimeSubscription = { payload: Uint8Array };
type ClientOptions = {
  endpoint?: string;
  createWebSocket?: (endpoint: string) => WebSocket;
  connectTimeoutMs?: number;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
};

export class GvgRealtimeClient {
  private readonly listeners = new Set<GvgRealtimeClientListener>();
  private socket?: WebSocket;
  private cleanup?: () => void;
  constructor(private readonly options: ClientOptions = {}) {}

  connect(subscription: string | GvgRealtimeSubscription): Promise<void> {
    if (this.socket) return Promise.reject(new Error("WebSocket is already active."));
    const socket = (this.options.createWebSocket ?? ((url) => new WebSocket(url, { perMessageDeflate: false })))(
      this.options.endpoint ?? GVG_REALTIME_WEBSOCKET_ENDPOINT,
    );
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    return new Promise((resolve, reject) => {
      let opened = false;
      let finished = false;
      let pingTimer: ReturnType<typeof setInterval> | undefined;
      let pongTimer: ReturnType<typeof setTimeout> | undefined;
      let expectedPong: string | undefined;
      let sequence = 0;
      const connectTimer = setTimeout(() => fail(new Error("WebSocket connect timed out.")), this.options.connectTimeoutMs ?? observationPolicy.connectTimeoutMs);
      const finish = (reason: string, code?: number) => {
        if (finished) return;
        finished = true;
        clearTimeout(connectTimer);
        clearInterval(pingTimer);
        clearTimeout(pongTimer);
        if (this.socket === socket) this.socket = undefined;
        this.cleanup = undefined;
        if (!opened) reject(new Error(`WebSocket closed before subscription: ${reason}`));
        this.emit({ type: "disconnected", reason, code });
      };
      const fail = (error: Error) => {
        if (finished) return;
        reject(error);
        finish(error.message);
        socket.terminate();
        this.emit({ type: "error", error });
      };
      this.cleanup = () => { finish("client stopped"); socket.terminate(); };
      socket.on("error", fail);
      socket.on("close", (code, reason) => finish(reason.toString() || "closed", code));
      socket.on("open", () => {
        if (finished) return;
        this.emit({ type: "opened" });
        socket.send(typeof subscription === "string" ? createGuildBattleSubscriptionPayload(subscription) : subscription.payload, (error) => {
          if (finished) return;
          if (error) { fail(error); return; }
          opened = true;
          clearTimeout(connectTimer);
          this.emit({ type: "subscriptionSent" });
          this.emit({ type: "connected" });
          resolve();
        });
        pingTimer = setInterval(() => {
          if (finished || expectedPong !== undefined) return;
          expectedPong = String(++sequence);
          pongTimer = setTimeout(() => fail(new Error("WebSocket pong timed out.")), this.options.pongTimeoutMs ?? observationPolicy.pongTimeoutMs);
          socket.ping(expectedPong, true, (error: Error | undefined) => { if (error) fail(error); });
        }, this.options.pingIntervalMs ?? observationPolicy.pingIntervalMs);
      });
      socket.on("pong", (payload) => {
        if (payload.toString() !== expectedPong) return;
        expectedPong = undefined;
        clearTimeout(pongTimer);
      });
      socket.on("message", (payload, binary) => {
        if (finished) return;
        if (!binary || !(payload instanceof ArrayBuffer)) { fail(new Error("Unsupported WebSocket payload.")); return; }
        this.emit({ type: "payloadReceived", payload: new Uint8Array(payload) });
      });
    });
  }

  disconnect(_reason?: string): void { this.cleanup?.(); }
  addEventListener(listener: GvgRealtimeClientListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private emit(event: GvgRealtimeClientEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
