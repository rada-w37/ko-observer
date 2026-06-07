import type { GvgCastleState, LocalGvgLatest } from "../mentemori/types.js";
import type { CastleObservationDiff } from "./castleObservationDiff.js";

export type ActiveGuildRole = "defender" | "attacker" | "both";

export type ObservedCastle = {
  castleId: number;
  gvgCastleState: GvgCastleState;
  rawLastWinPartyKnockOutCount: number;
  lastWinPartyDefeatedCount: number;
  observationDiff?: CastleObservationDiff;
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

export function attachObservationDiffs(
  activeGuilds: ActiveGuilds,
  observationDiffs: CastleObservationDiff[],
): ActiveGuilds {
  const observationDiffByCastleId = new Map(
    observationDiffs.map((observationDiff) => [observationDiff.castleId, observationDiff]),
  );

  return Object.fromEntries(
    Object.entries(activeGuilds).map(([guildId, activeGuild]) => [
      guildId,
      {
        ...activeGuild,
        castles: {
          defending: attachDiffsToCastles(
            activeGuild.castles.defending,
            observationDiffByCastleId,
          ),
          attacking: attachDiffsToCastles(
            activeGuild.castles.attacking,
            observationDiffByCastleId,
          ),
        },
      },
    ]),
  );
}

function attachDiffsToCastles(
  observedCastles: ObservedCastle[],
  observationDiffByCastleId: Map<number, CastleObservationDiff>,
): ObservedCastle[] {
  return observedCastles.map((observedCastle) => {
    const observationDiff = observationDiffByCastleId.get(observedCastle.castleId);
    if (!observationDiff) {
      return observedCastle;
    }

    return {
      ...observedCastle,
      observationDiff,
    };
  });
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
