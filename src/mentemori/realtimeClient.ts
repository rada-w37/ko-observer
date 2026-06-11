import { createGuildBattleSubscriptionPayload } from "./streamId.js";
import type { RealtimePayloadBytes } from "./realtimeParser.js";

export const GVG_REALTIME_WEBSOCKET_ENDPOINT = "wss://api.mentemori.icu/gvg";

type WebSocketFactory = (endpoint: string) => WebSocketLike;

type WebSocketMessageEventLike = {
  data: unknown;
};

type WebSocketLike = {
  binaryType?: string;
  readyState: number;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(type: "message", listener: (event: WebSocketMessageEventLike) => void): void;
  close(): void;
  send(payload: Uint8Array): void;
};

export type GvgRealtimeClientEvent =
  | { type: "opened" }
  | { type: "subscriptionSent" }
  | { type: "connected" }
  | { type: "disconnected"; reason?: string }
  | { type: "payloadReceived"; payload: RealtimePayloadBytes }
  | { type: "error"; error: Error };

export type GvgRealtimeClientListener = (event: GvgRealtimeClientEvent) => void;

export type GvgRealtimeClientOptions = {
  endpoint?: string;
  createWebSocket?: WebSocketFactory;
};

export type GvgRealtimeSubscription = {
  payload: Uint8Array;
};

const WEBSOCKET_OPEN = 1;

export class GvgRealtimeClient {
  private readonly endpoint: string;
  private readonly createWebSocket: WebSocketFactory;
  private readonly listeners = new Set<GvgRealtimeClientListener>();
  private socket: WebSocketLike | null = null;

  constructor(options: GvgRealtimeClientOptions = {}) {
    this.endpoint = options.endpoint ?? GVG_REALTIME_WEBSOCKET_ENDPOINT;
    this.createWebSocket =
      options.createWebSocket ??
      ((endpoint) => {
        const WebSocketConstructor = globalThis.WebSocket as
          | (new (url: string) => WebSocketLike)
          | undefined;
        if (!WebSocketConstructor) {
          throw new Error("WebSocket is not available in this Node.js runtime.");
        }
        return new WebSocketConstructor(endpoint);
      });
  }

  connect(worldIdOrSubscription: string | GvgRealtimeSubscription): Promise<void> {
    const socket = this.createWebSocket(this.endpoint);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    return new Promise((resolve, reject) => {
      socket.addEventListener("open", () => {
        this.emit({ type: "opened" });
        socket.send(
          typeof worldIdOrSubscription === "string"
            ? createGuildBattleSubscriptionPayload(worldIdOrSubscription)
            : worldIdOrSubscription.payload,
        );
        this.emit({ type: "subscriptionSent" });
        this.emit({ type: "connected" });
        resolve();
      });
      socket.addEventListener("message", (event) => {
        void this.emitPayload(event.data);
      });
      socket.addEventListener("close", () => {
        this.socket = null;
        this.emit({ type: "disconnected", reason: "closed" });
      });
      socket.addEventListener("error", () => {
        const error = new Error("GvG realtime WebSocket error");
        this.emit({ type: "error", error });
        reject(error);
      });
    });
  }

  disconnect(reason?: string): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WEBSOCKET_OPEN) {
      socket.close();
    }
    this.emit({ type: "disconnected", reason });
  }

  addEventListener(listener: GvgRealtimeClientListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async emitPayload(payload: unknown): Promise<void> {
    if (payload instanceof ArrayBuffer) {
      this.emit({ type: "payloadReceived", payload: new Uint8Array(payload) });
      return;
    }

    if (ArrayBuffer.isView(payload)) {
      this.emit({
        type: "payloadReceived",
        payload: new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength),
      });
      return;
    }

    const error = new Error("GvG realtime WebSocket received unsupported payload");
    this.emit({ type: "error", error });
  }

  private emit(event: GvgRealtimeClientEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
