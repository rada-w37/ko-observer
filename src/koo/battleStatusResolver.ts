import { GVG_CASTLE_STATE, type LocalGvgCastle } from "../mentemori/types.js";

export type BattleType = "guildBattle" | "grandBattle" | "unknown";

export type BattleScope =
  | {
      type: "world";
      id: string;
    }
  | {
      type: "grandBattleBlock";
      id: string;
      name?: string;
    }
  | {
      type: "unknown";
      id: string;
      name?: string;
    };

export type BattleStatusResolution = {
  battleType: BattleType;
  scope: BattleScope;
  isGuildBattleActive: boolean;
  unknownGvgCastleStates: number[];
};

const ACTIVE_GVG_CASTLE_STATES = new Set<number>([
  GVG_CASTLE_STATE.activeDeclared,
  GVG_CASTLE_STATE.activeBattle,
  GVG_CASTLE_STATE.activeOccupied,
  GVG_CASTLE_STATE.activeOther,
]);
const INACTIVE_GVG_CASTLE_STATE = GVG_CASTLE_STATE.inactive;

export function resolveBattleStatus(
  castles: LocalGvgCastle[],
  worldId: string,
): BattleStatusResolution {
  const unknownGvgCastleStates = collectUnknownGvgCastleStates(castles);
  const isGuildBattleActive = castles.some((castle) =>
    ACTIVE_GVG_CASTLE_STATES.has(castle.gvgCastleState),
  );

  if (!isGuildBattleActive) {
    return {
      battleType: "unknown",
      scope: {
        type: "unknown",
        id: worldId,
      },
      isGuildBattleActive: false,
      unknownGvgCastleStates,
    };
  }

  return {
    battleType: "guildBattle",
    scope: {
      type: "world",
      id: worldId,
    },
    isGuildBattleActive: true,
    unknownGvgCastleStates,
  };
}

function collectUnknownGvgCastleStates(castles: LocalGvgCastle[]): number[] {
  const unknownStates = new Set<number>();

  for (const castle of castles) {
    const state = castle.gvgCastleState;
    if (state !== INACTIVE_GVG_CASTLE_STATE && !ACTIVE_GVG_CASTLE_STATES.has(state)) {
      unknownStates.add(state);
    }
  }

  return [...unknownStates];
}
