import type { GvgCastleState, LocalGvgLatest } from "../mentemori/types.js";

export type ActiveGuildRole = "defender" | "attacker" | "both";

export type ObservedCastle = {
  castleId: number;
  gvgCastleState: GvgCastleState;
  rawLastWinPartyKnockOutCount: number;
  lastWinPartyDefeatedCount: number;
};

export type ActiveGuild = {
  guildId: string;
  guildName: string;
  role: ActiveGuildRole;
  castles: {
    defending: ObservedCastle[];
    attacking: ObservedCastle[];
  };
};

export type ActiveGuilds = Record<string, ActiveGuild>;

export function extractActiveGuilds(localGvg: LocalGvgLatest): ActiveGuilds {
  const activeGuilds: ActiveGuilds = {};

  for (const castle of localGvg.castles) {
    addActiveGuild(activeGuilds, localGvg.guilds, castle.GuildId, "defender", {
      castleId: castle.CastleId,
      gvgCastleState: castle.GvgCastleState,
      rawLastWinPartyKnockOutCount: castle.LastWinPartyKnockOutCount,
      lastWinPartyDefeatedCount: castle.LastWinPartyKnockOutCount,
    });
    addActiveGuild(activeGuilds, localGvg.guilds, castle.AttackerGuildId, "attacker", {
      castleId: castle.CastleId,
      gvgCastleState: castle.GvgCastleState,
      rawLastWinPartyKnockOutCount: castle.LastWinPartyKnockOutCount,
      lastWinPartyDefeatedCount: castle.LastWinPartyKnockOutCount,
    });
  }

  return activeGuilds;
}

function addActiveGuild(
  activeGuilds: ActiveGuilds,
  guilds: Record<string, string>,
  guildId: number,
  role: Exclude<ActiveGuildRole, "both">,
  observedCastle: ObservedCastle,
): void {
  if (guildId === 0) {
    return;
  }

  const guildKey = guildId.toString();
  const existingGuild = activeGuilds[guildKey];

  if (!existingGuild) {
    activeGuilds[guildKey] = {
      guildId: guildKey,
      guildName: guilds[guildKey] ?? `Guild ${guildKey}`,
      role,
      castles: {
        defending: [],
        attacking: [],
      },
    };
  } else if (existingGuild.role !== role) {
    existingGuild.role = "both";
  }

  const activeGuild = activeGuilds[guildKey];
  if (role === "defender") {
    activeGuild.castles.defending.push(observedCastle);
    return;
  }

  activeGuild.castles.attacking.push(observedCastle);
}
