import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { GvgRealtimeClient, type GvgRealtimeClientEvent } from "../src/mentemori/realtimeClient.js";

async function server(autoPong = true) {
  const socketServer = new WebSocketServer({ host: "127.0.0.1", port: 0, autoPong });
  await new Promise<void>((resolve, reject) => { socketServer.once("listening", resolve); socketServer.once("error", reject); });
  const address = socketServer.address();
  if (typeof address === "string" || !address) throw new Error("Missing local test address");
  return { socketServer, endpoint: `ws://127.0.0.1:${address.port}`, async close() {
    socketServer.clients.forEach((socket) => socket.terminate());
    await new Promise<void>((resolve) => socketServer.close(() => resolve()));
  } };
}

test("binary subscription and payload survive a quiet connection with standard ping/pong", async () => {
  const local = await server();
  const subscription = new Uint8Array([0, 0, 104, 32]);
  let pings = 0;
  local.socketServer.on("connection", (socket) => {
    socket.on("ping", () => pings++);
    socket.on("message", (data) => { assert.deepEqual(new Uint8Array(data as Buffer), subscription); socket.send(new Uint8Array([1, 2, 3])); });
  });
  const events: GvgRealtimeClientEvent[] = [];
  let resolveReceived!: (bytes: Uint8Array) => void;
  const received = new Promise<Uint8Array>((resolve) => { resolveReceived = resolve; });
  const client = new GvgRealtimeClient({ endpoint: local.endpoint, connectTimeoutMs: 1000, pingIntervalMs: 30, pongTimeoutMs: 200 });
  client.addEventListener((event) => { events.push(event); if (event.type === "payloadReceived") resolveReceived(new Uint8Array(event.payload)); });
  try {
    await client.connect({ payload: subscription });
    assert.deepEqual(await received, new Uint8Array([1, 2, 3]));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(pings >= 2);
    assert.equal(events.some((event) => event.type === "disconnected"), false);
  } finally { client.disconnect(); await local.close(); }
});

test("missing pong terminates an apparently open connection", async () => {
  const local = await server(false);
  const client = new GvgRealtimeClient({ endpoint: local.endpoint, connectTimeoutMs: 1000, pingIntervalMs: 20, pongTimeoutMs: 50 });
  const closed = new Promise<GvgRealtimeClientEvent>((resolve) => client.addEventListener((event) => { if (event.type === "disconnected") resolve(event); }));
  try {
    await client.connect({ payload: new Uint8Array(4) });
    const result = await closed;
    assert.equal(result.type, "disconnected");
    if (result.type === "disconnected") assert.match(result.reason ?? "", /pong timed out/);
  } finally { client.disconnect(); await local.close(); }
});

test("closing before handshake rejects connect instead of leaving it pending", async () => {
  const http = createServer();
  http.on("upgrade", (_request, socket) => socket.destroy());
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing local test address");
  const client = new GvgRealtimeClient({ endpoint: `ws://127.0.0.1:${address.port}`, connectTimeoutMs: 100 });
  try { await assert.rejects(client.connect({ payload: new Uint8Array(4) })); }
  finally { client.disconnect(); await new Promise<void>((resolve) => http.close(() => resolve())); }
});
