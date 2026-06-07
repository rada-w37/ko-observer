import type { LocalGvgCastle, LocalGvgGuild, LocalGvgLatest } from "./types.js";

type FetchFunction = typeof fetch;

const BASE_URL = "https://mentemori.icu";

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
  const castleItems = findCastleItems(responseBody);

  if (!castleItems) {
    throw new Error(`Unexpected localgvg/latest response shape: url=${url}`);
  }

  return {
    castles: castleItems.map(normalizeCastle),
  };
}

function findCastleItems(responseBody: unknown): unknown[] | undefined {
  if (Array.isArray(responseBody)) {
    return responseBody;
  }

  if (!isRecord(responseBody)) {
    return undefined;
  }

  const candidateKeys = ["castles", "Castles", "localGvg", "LocalGvg", "data", "Data", "items", "Items"];
  for (const candidateKey of candidateKeys) {
    const candidate = responseBody[candidateKey];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function normalizeCastle(rawCastle: unknown): LocalGvgCastle {
  if (!isRecord(rawCastle)) {
    return {
      gvgCastleState: -1,
    };
  }

  return {
    gvgCastleState: readNumber(rawCastle, ["GvgCastleState", "gvgCastleState"]) ?? -1,
    defenderGuild: readGuild(rawCastle, [
      "Guild",
      "guild",
      "DefenderGuild",
      "defenderGuild",
      "OccupyGuild",
      "occupyGuild",
    ]),
    attackerGuild: readGuild(rawCastle, ["AttackerGuild", "attackerGuild"]),
  };
}

function readGuild(rawCastle: Record<string, unknown>, guildKeys: string[]): LocalGvgGuild | undefined {
  for (const guildKey of guildKeys) {
    const rawGuild = rawCastle[guildKey];
    const guild = normalizeGuild(rawGuild);
    if (guild) {
      return guild;
    }
  }

  const guildName = readString(rawCastle, ["GuildName", "guildName", "DefenderGuildName", "defenderGuildName"]);
  if (!guildName) {
    return undefined;
  }

  return {
    guildId: readString(rawCastle, ["GuildId", "guildId", "DefenderGuildId", "defenderGuildId"]),
    guildName,
  };
}

function normalizeGuild(rawGuild: unknown): LocalGvgGuild | undefined {
  if (!isRecord(rawGuild)) {
    return undefined;
  }

  const guildName = readString(rawGuild, ["GuildName", "guildName", "Name", "name"]);
  if (!guildName) {
    return undefined;
  }

  return {
    guildId: readString(rawGuild, ["GuildId", "guildId", "Id", "id"]),
    guildName,
  };
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
  }

  return undefined;
}

function readString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    if (typeof value === "number") {
      return value.toString();
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
