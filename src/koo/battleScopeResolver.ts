import { fetchLatestLocalGvg } from "../mentemori/apiClient.js";
import {
  fetchGrandBattleLatest,
  fetchGrandBattleWorldGroups,
  type GrandBattleLatest,
} from "../mentemori/grandBattleApiClient.js";
import { resolveBattleStatus } from "./battleStatusResolver.js";

type FetchFunction = typeof fetch;

export type BattleSubscriptionScope =
  | {
      battleType: "guildBattle";
      subscriptionType: "guildBattle";
      worldId: string;
      guildId: string | null;
      worldGroupId: null;
      classId: null;
      blockId: null;
    }
  | {
      battleType: "grandBattle";
      subscriptionType: "grandBattle";
      worldId: string;
      guildId: string;
      worldGroupId: number;
      classId: number;
      blockId: number;
      participantGuilds: GrandBattleParticipantGuild[];
    }
  | {
      battleType: "unknown";
      subscriptionType: "none";
      worldId: string;
      guildId: string | null;
      worldGroupId: number | null;
      classId: null;
      blockId: null;
      reason: string;
    };

export type GrandBattleParticipantGuild = {
  guildId: string;
  guildName: string;
};

const GRAND_BATTLE_CLASS_IDS = [1, 2, 3] as const;
const GRAND_BATTLE_BLOCK_IDS = [0, 1, 2, 3] as const;

export async function resolveBattleSubscriptionScope(
  input: {
    worldId: string;
    guildId?: string;
  },
  fetchFn: FetchFunction = fetch,
): Promise<BattleSubscriptionScope> {
  const localGvg = await fetchLatestLocalGvg(input.worldId, fetchFn);
  const battleStatus = resolveBattleStatus(localGvg.castles, input.worldId);
  const guildId = normalizeGuildId(input.guildId);

  if (battleStatus.battleType === "guildBattle") {
    return {
      battleType: "guildBattle",
      subscriptionType: "guildBattle",
      worldId: input.worldId,
      guildId,
      worldGroupId: null,
      classId: null,
      blockId: null,
    };
  }

  if (!guildId) {
    return {
      battleType: "unknown",
      subscriptionType: "none",
      worldId: input.worldId,
      guildId: null,
      worldGroupId: null,
      classId: null,
      blockId: null,
      reason: "KOO_GUILD_ID is required when Guild Battle is not active.",
    };
  }

  const worldGroupId = await resolveWorldGroupId(input.worldId, fetchFn);
  if (worldGroupId === null) {
    return {
      battleType: "unknown",
      subscriptionType: "none",
      worldId: input.worldId,
      guildId,
      worldGroupId: null,
      classId: null,
      blockId: null,
      reason: `Grand Battle worldGroupId was not found for worldId=${input.worldId}.`,
    };
  }

  const grandBattleScope = await findGrandBattleScope({ worldGroupId, guildId }, fetchFn);
  if (!grandBattleScope) {
    return {
      battleType: "unknown",
      subscriptionType: "none",
      worldId: input.worldId,
      guildId,
      worldGroupId,
      classId: null,
      blockId: null,
      reason: `Grand Battle class/block was not found for guildId=${guildId}.`,
    };
  }

  return {
    battleType: "grandBattle",
    subscriptionType: "grandBattle",
    worldId: input.worldId,
    guildId,
    worldGroupId,
    classId: grandBattleScope.classId,
    blockId: grandBattleScope.blockId,
    participantGuilds: grandBattleScope.participantGuilds,
  };
}

async function resolveWorldGroupId(
  worldId: string,
  fetchFn: FetchFunction,
): Promise<number | null> {
  const numericWorldId = Number(worldId.trim());
  if (!Number.isInteger(numericWorldId)) {
    throw new Error("KOO_WORLD_ID must be an integer for Grand Battle scope resolution.");
  }

  const worldGroups = await fetchGrandBattleWorldGroups(fetchFn);
  return worldGroups.find((worldGroup) => worldGroup.worlds.includes(numericWorldId))?.groupId ?? null;
}

async function findGrandBattleScope(
  input: {
    worldGroupId: number;
    guildId: string;
  },
  fetchFn: FetchFunction,
): Promise<{
  classId: number;
  blockId: number;
  participantGuilds: GrandBattleParticipantGuild[];
} | null> {
  for (const classId of GRAND_BATTLE_CLASS_IDS) {
    for (const blockId of GRAND_BATTLE_BLOCK_IDS) {
      const latest = await fetchGrandBattleLatest(
        {
          worldGroupId: input.worldGroupId,
          classId,
          blockId,
        },
        fetchFn,
      );

      if (containsGuild(latest, input.guildId)) {
        return {
          classId,
          blockId,
          participantGuilds: extractParticipantGuilds(latest),
        };
      }
    }
  }

  return null;
}

function extractParticipantGuilds(latest: GrandBattleLatest): GrandBattleParticipantGuild[] {
  return Object.entries(latest.guilds)
    .filter(
      (entry): entry is [string, string] =>
        entry[0].trim().length > 0 && entry[1].trim().length > 0,
    )
    .sort(([leftGuildId], [rightGuildId]) => leftGuildId.localeCompare(rightGuildId))
    .slice(0, 4)
    .map(([guildId, guildName]) => ({
      guildId: guildId.trim(),
      guildName,
    }));
}

function containsGuild(latest: GrandBattleLatest, guildId: string): boolean {
  if (Object.keys(latest.guilds).some((candidateGuildId) => candidateGuildId.trim() === guildId)) {
    return true;
  }

  return latest.castles.some(
    (castle) => castle.GuildId === guildId || castle.AttackerGuildId === guildId,
  );
}

function normalizeGuildId(guildId: string | undefined): string | null {
  const normalizedGuildId = guildId?.trim();
  return normalizedGuildId ? normalizedGuildId : null;
}
