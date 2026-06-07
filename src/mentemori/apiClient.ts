import type { GvgCastleState, LocalGvgCastle, LocalGvgLatest } from "./types.js";

type FetchFunction = typeof fetch;

const BASE_URL = "https://api.mentemori.icu";

export async function fetchLatestLocalGvg(
  worldId: string,
  fetchFn: FetchFunction = fetch,
): Promise<LocalGvgLatest> {
  const url = `${BASE_URL}/${encodeURIComponent(worldId)}/localgvg/latest`;
  const response = await fetchFn(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch localgvg/latest: status=${response.status} url=${url}`);
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch (error) {
    throw new Error(`Failed to parse localgvg/latest JSON: url=${url}`, { cause: error });
  }

  return normalizeLocalGvgLatest(responseBody, url);
}

function normalizeLocalGvgLatest(responseBody: unknown, url: string): LocalGvgLatest {
  if (!isRecord(responseBody)) {
    throw new Error(`Unexpected localgvg/latest response shape: url=${url}`);
  }

  const status = responseBody.status;
  const timestamp = responseBody.timestamp;
  const data = responseBody.data;
  if (typeof status !== "number" || typeof timestamp !== "number" || !isRecord(data)) {
    throw new Error(`Unexpected localgvg/latest response envelope: url=${url}`);
  }

  const worldId = data.world_id;
  const castles = data.castles;
  const guilds = data.guilds;
  if (typeof worldId !== "number" || !Array.isArray(castles) || !isGuildMap(guilds)) {
    throw new Error(`Unexpected localgvg/latest data shape: url=${url}`);
  }

  return {
    worldId,
    guilds,
    castles: castles.map((castle) => normalizeCastle(castle, url)),
  };
}

function normalizeCastle(rawCastle: unknown, url: string): LocalGvgCastle {
  if (!isRecord(rawCastle)) {
    throw new Error(`Unexpected localgvg/latest castle shape: url=${url}`);
  }

  const CastleId = readNumber(rawCastle, "CastleId");
  const GuildId = readNumber(rawCastle, "GuildId");
  const AttackerGuildId = readNumber(rawCastle, "AttackerGuildId");
  const DefensePartyCount = readNumber(rawCastle, "DefensePartyCount");
  const GvgCastleState = readGvgCastleState(rawCastle, "GvgCastleState");
  const LastWinPartyKnockOutCount = readNumber(rawCastle, "LastWinPartyKnockOutCount");

  if (
    CastleId === undefined ||
    GuildId === undefined ||
    AttackerGuildId === undefined ||
    DefensePartyCount === undefined ||
    GvgCastleState === undefined ||
    LastWinPartyKnockOutCount === undefined
  ) {
    throw new Error(`Unexpected localgvg/latest castle fields: url=${url}`);
  }

  return {
    CastleId,
    GuildId,
    AttackerGuildId,
    DefensePartyCount,
    GvgCastleState,
    LastWinPartyKnockOutCount,
  };
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" ? value : undefined;
}

function readGvgCastleState(
  record: Record<string, unknown>,
  key: string,
): GvgCastleState | undefined {
  const value = readNumber(record, key);
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }

  return undefined;
}

function isGuildMap(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((guildName) => typeof guildName === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
