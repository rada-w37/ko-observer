import assert from "node:assert/strict";
import test from "node:test";
import { parseRealtimePayload } from "./realtimeParser.js";
import { buildGvgStreamId } from "./streamId.js";

const guildStreamId = buildGvgStreamId({
  castleId: 0,
  block: 0,
  worldGroupId: 0,
  gvgClass: 0,
  worldId: 1001,
});
const castleStreamId = buildGvgStreamId({
  castleId: 1,
  block: 0,
  worldGroupId: 0,
  gvgClass: 0,
  worldId: 1001,
});

test("parses castle status bytes using little-endian offsets", () => {
  const result = parseRealtimePayload(
    createCastleStatusBytes({
      guildId: 438130839,
      attackerGuildId: 123456789,
      defensePartyCount: 513,
      attackPartyCount: 258,
      koCount: 1027,
    }),
  );

  assert.equal(result.status, "ok");
  assert.deepEqual(result.messages, [
    {
      type: "castleStatus",
      streamId: castleStreamId,
      castleId: 1,
      guildId: "438130839",
      attackerGuildId: "123456789",
      defensePartyCount: 513,
      attackPartyCount: 258,
      gvgCastleState: 1,
      lastWinPartyKnockOutCount: 1027,
    },
  ]);
});

test("parses guild messages and multiple messages", () => {
  const result = parseRealtimePayload([
    ...createGuildMessageBytes(438130839, "Guild"),
    ...createCastleStatusBytes(),
  ]);

  assert.equal(result.status, "ok");
  assert.equal(result.messages.length, 2);
  assert.deepEqual(result.messages[0], {
    type: "guild",
    streamId: guildStreamId,
    guildId: "438130839",
    guildName: "Guild",
    clearsPreviousGuilds: false,
  });
});

test("returns parser error for broken payloads without throwing", () => {
  const result = parseRealtimePayload([1, 2, 3]);

  assert.equal(result.status, "error");
  assert.equal(result.messages[0]?.type, "unknown");
});

function createGuildMessageBytes(guildId: number, guildName: string): number[] {
  const guildNameBytes = Array.from(new TextEncoder().encode(guildName));
  return [
    ...writeUint32(guildStreamId),
    ...writeUint32(guildId),
    guildNameBytes.length,
    ...guildNameBytes,
  ];
}

function createCastleStatusBytes(
  overrides: Partial<{
    guildId: number;
    attackerGuildId: number;
    defensePartyCount: number;
    attackPartyCount: number;
    koCount: number;
  }> = {},
): number[] {
  return [
    ...writeUint32(castleStreamId),
    ...writeUint32(overrides.guildId ?? 438130839),
    ...writeUint32(overrides.attackerGuildId ?? 0),
    ...writeUint32(0),
    ...writeUint16(overrides.defensePartyCount ?? 10),
    ...writeUint16(overrides.attackPartyCount ?? 0),
    1,
    0,
    ...writeUint16(overrides.koCount ?? 0),
  ];
}

function writeUint32(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return [...bytes];
}

function writeUint16(value: number): number[] {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return [...bytes];
}
