import { decodeGvgStreamId, type GvgStreamId } from "./streamId.js";

export type RealtimePayloadBytes = Uint8Array | readonly number[];

export type RawRealtimeMessage = RawCastleStatusMessage | RawGuildMessage | RawUnknownMessage;

export type RawCastleStatusMessage = {
  type: "castleStatus";
  streamId: GvgStreamId;
  castleId: number;
  guildId: string | null;
  attackerGuildId: string | null;
  defensePartyCount: number;
  attackPartyCount: number;
  lastWinPartyKnockOutCount: number;
};

export type RawGuildMessage = {
  type: "guild";
  streamId: GvgStreamId;
  guildId: string | null;
  guildName: string | null;
  clearsPreviousGuilds: boolean;
};

export type RawUnknownMessage = {
  type: "unknown";
  streamId?: GvgStreamId;
  reason: string;
  bytes: readonly number[];
};

export type RealtimeParserResult =
  | { status: "ok"; messages: RawRealtimeMessage[] }
  | { status: "error"; messages: RawRealtimeMessage[]; error: Error };

const STREAM_ID_SIZE = 4;
const GUILD_MESSAGE_HEADER_SIZE = 9;
const CASTLE_STATUS_MESSAGE_SIZE = 24;

export function parseRealtimePayload(payload: RealtimePayloadBytes): RealtimeParserResult {
  const bytes = toUint8Array(payload);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const messages: RawRealtimeMessage[] = [];
  let offset = 0;

  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < STREAM_ID_SIZE) {
      return parserError(messages, "payload ended before stream ID", bytes, offset);
    }

    const streamId = view.getUint32(offset, true) as GvgStreamId;
    const { castleId } = decodeGvgStreamId(streamId);

    if (castleId === 0) {
      const guildMessage = parseGuildMessage(view, bytes, offset, streamId);
      if (guildMessage.status === "error") {
        return parserError(messages, guildMessage.reason, bytes, offset, streamId);
      }
      messages.push(guildMessage.message);
      offset += guildMessage.byteLength;
      continue;
    }

    if (castleId >= 1 && castleId <= 21) {
      const castleMessage = parseCastleStatusMessage(view, bytes, offset, streamId, castleId);
      if (castleMessage.status === "error") {
        return parserError(messages, castleMessage.reason, bytes, offset, streamId);
      }
      messages.push(castleMessage.message);
      offset += CASTLE_STATUS_MESSAGE_SIZE;
      continue;
    }

    messages.push({
      type: "unknown",
      streamId,
      reason: `unknown castle ID in stream ID: ${castleId}`,
      bytes: Array.from(bytes.slice(offset)),
    });
    return { status: "ok", messages };
  }

  return { status: "ok", messages };
}

function parseGuildMessage(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  streamId: GvgStreamId,
):
  | { status: "ok"; message: RawGuildMessage; byteLength: number }
  | { status: "error"; reason: string } {
  if (bytes.byteLength - offset < GUILD_MESSAGE_HEADER_SIZE) {
    return { status: "error", reason: "payload ended inside guild message header" };
  }

  const rawGuildId = view.getUint32(offset + 4, true);
  const guildNameLength = view.getUint8(offset + 8);
  const byteLength = GUILD_MESSAGE_HEADER_SIZE + guildNameLength;
  if (bytes.byteLength - offset < byteLength) {
    return { status: "error", reason: "payload ended inside guild name" };
  }

  const guildNameBytes = bytes.slice(offset + GUILD_MESSAGE_HEADER_SIZE, offset + byteLength);
  return {
    status: "ok",
    byteLength,
    message: {
      type: "guild",
      streamId,
      guildId: normalizeGuildId(rawGuildId),
      guildName: guildNameBytes.byteLength === 0 ? null : new TextDecoder().decode(guildNameBytes),
      clearsPreviousGuilds: rawGuildId === 0,
    },
  };
}

function parseCastleStatusMessage(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  streamId: GvgStreamId,
  castleId: number,
):
  | { status: "ok"; message: RawCastleStatusMessage }
  | { status: "error"; reason: string } {
  if (bytes.byteLength - offset < CASTLE_STATUS_MESSAGE_SIZE) {
    return { status: "error", reason: "payload ended inside castle status message" };
  }

  return {
    status: "ok",
    message: {
      type: "castleStatus",
      streamId,
      castleId,
      guildId: normalizeGuildId(view.getUint32(offset + 4, true)),
      attackerGuildId: normalizeGuildId(view.getUint32(offset + 8, true)),
      defensePartyCount: view.getUint16(offset + 16, true),
      attackPartyCount: view.getUint16(offset + 18, true),
      lastWinPartyKnockOutCount: view.getUint16(offset + 22, true),
    },
  };
}

function normalizeGuildId(guildId: number): string | null {
  return guildId === 0 ? null : guildId.toString();
}

function parserError(
  messages: RawRealtimeMessage[],
  reason: string,
  bytes: Uint8Array,
  offset: number,
  streamId?: GvgStreamId,
): RealtimeParserResult {
  return {
    status: "error",
    messages: [
      ...messages,
      {
        type: "unknown",
        streamId,
        reason,
        bytes: Array.from(bytes.slice(offset)),
      },
    ],
    error: new Error(reason),
  };
}

function toUint8Array(payload: RealtimePayloadBytes): Uint8Array {
  return payload instanceof Uint8Array ? payload : new Uint8Array(payload);
}
