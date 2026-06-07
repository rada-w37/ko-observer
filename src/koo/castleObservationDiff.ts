import { GVG_CASTLE_STATE, type GvgCastleState, type LocalGvgLatest } from "../mentemori/types.js";
import type { ActiveGuilds, ObservedCastle } from "./activeGuildExtractor.js";

export type CastleObservation = {
  castleId: number;
  count: number;
  gvgCastleState: GvgCastleState | number;
  defenderGuildId: number;
  attackerGuildId: number;
};

export type CastleObservationMap = Record<string, CastleObservation>;

export type CastleObservationDiff = {
  castleId: number;
  previousCount: number;
  currentCount: number;
  countDelta: number;
  isCountIncreased: boolean;
  isCountReset: boolean;
  isStateChanged: boolean;
  isDefenderChanged: boolean;
  isAttackerChanged: boolean;
};

const DEFAULT_CASTLE_OBSERVATION = {
  count: 0,
  gvgCastleState: GVG_CASTLE_STATE.inactive,
  defenderGuildId: 0,
  attackerGuildId: 0,
} as const;

export function calculateCastleObservationDiffs(
  previousObservations: CastleObservationMap,
  currentObservations: CastleObservationMap,
): CastleObservationDiff[] {
  const castleIds = new Set([
    ...Object.keys(previousObservations),
    ...Object.keys(currentObservations),
  ]);

  return [...castleIds]
    .map((castleId) => Number(castleId))
    .sort((leftCastleId, rightCastleId) => leftCastleId - rightCastleId)
    .map((castleId) => {
      const previousObservation = previousObservations[castleId.toString()] ?? {
        castleId,
        ...DEFAULT_CASTLE_OBSERVATION,
      };
      const currentObservation = currentObservations[castleId.toString()] ?? {
        castleId,
        ...DEFAULT_CASTLE_OBSERVATION,
      };
      const countDelta = currentObservation.count - previousObservation.count;

      return {
        castleId,
        previousCount: previousObservation.count,
        currentCount: currentObservation.count,
        countDelta,
        isCountIncreased: countDelta > 0,
        isCountReset: currentObservation.count < previousObservation.count,
        isStateChanged:
          currentObservation.gvgCastleState !== previousObservation.gvgCastleState,
        isDefenderChanged:
          currentObservation.defenderGuildId !== previousObservation.defenderGuildId,
        isAttackerChanged:
          currentObservation.attackerGuildId !== previousObservation.attackerGuildId,
      };
    });
}

export function createCastleObservationMapFromLocalGvg(
  localGvg: LocalGvgLatest,
): CastleObservationMap {
  const observations: CastleObservationMap = {};

  for (const castle of localGvg.castles) {
    observations[castle.CastleId.toString()] = {
      castleId: castle.CastleId,
      count: castle.LastWinPartyKnockOutCount,
      gvgCastleState: castle.GvgCastleState,
      defenderGuildId: castle.GuildId,
      attackerGuildId: castle.AttackerGuildId,
    };
  }

  return observations;
}

export function createCastleObservationMapFromActiveGuilds(
  activeGuilds: ActiveGuilds,
): CastleObservationMap {
  const observations: CastleObservationMap = {};

  for (const activeGuild of Object.values(activeGuilds)) {
    for (const defendingCastle of activeGuild.castles?.defending ?? []) {
      const castleObservation = getOrCreateObservation(observations, defendingCastle);
      castleObservation.defenderGuildId = parseGuildId(activeGuild.guildId);
    }

    for (const attackingCastle of activeGuild.castles?.attacking ?? []) {
      const castleObservation = getOrCreateObservation(observations, attackingCastle);
      castleObservation.attackerGuildId = parseGuildId(activeGuild.guildId);
    }
  }

  return observations;
}

function parseGuildId(guildId: string): number {
  const parsedGuildId = Number(guildId);
  return Number.isFinite(parsedGuildId) ? parsedGuildId : 0;
}

function getOrCreateObservation(
  observations: CastleObservationMap,
  observedCastle: ObservedCastle,
): CastleObservation {
  const castleKey = observedCastle.castleId.toString();
  const existingObservation = observations[castleKey];

  if (existingObservation) {
    return existingObservation;
  }

  const castleObservation = {
    castleId: observedCastle.castleId,
    count: observedCastle.rawLastWinPartyKnockOutCount,
    gvgCastleState: observedCastle.gvgCastleState,
    defenderGuildId: 0,
    attackerGuildId: 0,
  };

  observations[castleKey] = castleObservation;
  return castleObservation;
}
