import type { LocalGvgCastle, LocalGvgGuild } from "../mentemori/types.js";

export type ActiveGuildRole = "defender" | "attacker" | "both";

export type ActiveGuild = {
  guildId: string;
  guildName: string;
  role: ActiveGuildRole;
  baselineKoCount: 0;
  koCount: 0;
  currentRawKoCount: 0;
};

export type ActiveGuilds = Record<string, ActiveGuild>;

export function extractActiveGuilds(castles: LocalGvgCastle[]): ActiveGuilds {
  const activeGuilds: ActiveGuilds = {};

  for (const castle of castles) {
    addActiveGuild(activeGuilds, castle.defenderGuild, "defender");
    addActiveGuild(activeGuilds, castle.attackerGuild, "attacker");
  }

  return activeGuilds;
}

function addActiveGuild(
  activeGuilds: ActiveGuilds,
  guild: LocalGvgGuild | undefined,
  role: Exclude<ActiveGuildRole, "both">,
): void {
  if (!guild) {
    return;
  }

  const guildKey = guild.guildId ?? guild.guildName;
  const existingGuild = activeGuilds[guildKey];

  if (!existingGuild) {
    activeGuilds[guildKey] = {
      guildId: guild.guildId ?? guild.guildName,
      guildName: guild.guildName,
      role,
      baselineKoCount: 0,
      koCount: 0,
      currentRawKoCount: 0,
    };
    return;
  }

  if (existingGuild.role !== role) {
    existingGuild.role = "both";
  }
}
