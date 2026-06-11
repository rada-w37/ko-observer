type FetchFunction = typeof fetch;

const BASE_URL = "https://api.mentemori.icu";

export type GrandBattleWorldGroup = {
  groupId: number;
  worlds: number[];
};

export type GrandBattleLatest = {
  guilds: Record<string, string>;
  castles: GrandBattleCastle[];
};

export type GrandBattleCastle = {
  GuildId: string;
  AttackerGuildId: string;
};

export async function fetchGrandBattleWorldGroups(
  fetchFn: FetchFunction = fetch,
): Promise<GrandBattleWorldGroup[]> {
  const url = `${BASE_URL}/wgroups`;
  const responseBody = await fetchJson(url, fetchFn, "wgroups");

  if (!isRecord(responseBody) || !Array.isArray(responseBody.data)) {
    throw new Error(`Unexpected wgroups response envelope: url=${url}`);
  }

  return responseBody.data.map((worldGroup) => normalizeWorldGroup(worldGroup, url));
}

export async function fetchGrandBattleLatest(
  source: {
    worldGroupId: number;
    classId: number;
    blockId: number;
  },
  fetchFn: FetchFunction = fetch,
): Promise<GrandBattleLatest> {
  const url = `${BASE_URL}/wg/${source.worldGroupId}/globalgvg/${source.classId}/${source.blockId}/latest`;
  const responseBody = await fetchJson(url, fetchFn, "globalgvg/latest");

  if (!isRecord(responseBody) || !isRecord(responseBody.data)) {
    throw new Error(`Unexpected globalgvg/latest response envelope: url=${url}`);
  }

  const guilds = responseBody.data.guilds;
  const castles = responseBody.data.castles;
  if (!isGuildMap(guilds) || !Array.isArray(castles)) {
    throw new Error(`Unexpected globalgvg/latest data shape: url=${url}`);
  }

  return {
    guilds,
    castles: castles.map((castle) => normalizeGrandBattleCastle(castle, url)),
  };
}

async function fetchJson(
  url: string,
  fetchFn: FetchFunction,
  endpointName: string,
): Promise<unknown> {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${endpointName}: status=${response.status} url=${url}`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Failed to parse ${endpointName} JSON: url=${url}`, { cause: error });
  }
}

function normalizeWorldGroup(rawWorldGroup: unknown, url: string): GrandBattleWorldGroup {
  if (!isRecord(rawWorldGroup)) {
    throw new Error(`Unexpected wgroups item shape: url=${url}`);
  }

  const groupId = readNumber(rawWorldGroup.group_id);
  const worlds = Array.isArray(rawWorldGroup.worlds)
    ? rawWorldGroup.worlds.map(readNumber).filter((world): world is number => world !== undefined)
    : undefined;

  if (groupId === undefined || worlds === undefined) {
    throw new Error(`Unexpected wgroups item fields: url=${url}`);
  }

  return {
    groupId,
    worlds,
  };
}

function normalizeGrandBattleCastle(rawCastle: unknown, url: string): GrandBattleCastle {
  if (!isRecord(rawCastle)) {
    throw new Error(`Unexpected globalgvg/latest castle shape: url=${url}`);
  }

  const GuildId = readGuildId(rawCastle.GuildId);
  const AttackerGuildId = readGuildId(rawCastle.AttackerGuildId);
  if (GuildId === undefined || AttackerGuildId === undefined) {
    throw new Error(`Unexpected globalgvg/latest castle fields: url=${url}`);
  }

  return {
    GuildId,
    AttackerGuildId,
  };
}

function readGuildId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === "string") {
    return value.trim();
  }

  return undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : undefined;
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
