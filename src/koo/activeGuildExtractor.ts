import type { LocalGvgLatest } from "../mentemori/types.js";

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

export function extractActiveGuilds(localGvg: LocalGvgLatest): ActiveGuilds {
  const activeGuilds: ActiveGuilds = {};

  for (const castle of localGvg.castles) {
    addActiveGuild(activeGuilds, localGvg.guilds, castle.GuildId, "defender");
    addActiveGuild(activeGuilds, localGvg.guilds, castle.AttackerGuildId, "attacker");
  }

  return activeGuilds;
}

function addActiveGuild(
  activeGuilds: ActiveGuilds,
  guilds: Record<string, string>,
  guildId: number,
  role: Exclude<ActiveGuildRole, "both">,
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
