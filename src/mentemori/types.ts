export const GVG_CASTLE_STATE = {
  inactive: 0,
  activeDeclared: 1,
  activeBattle: 2,
  activeCounterattack: 3,
  activeCounterattackSuccessful: 4,
} as const;

export type GvgCastleState = (typeof GVG_CASTLE_STATE)[keyof typeof GVG_CASTLE_STATE];

export type LocalGvgCastle = {
  CastleId: number;
  GuildId: number;
  AttackerGuildId: number;
  DefensePartyCount: number;
  GvgCastleState: GvgCastleState;
  LastWinPartyKnockOutCount: number;
};

export type LocalGvgLatest = {
  worldId: number;
  guilds: Record<string, string>;
  castles: LocalGvgCastle[];
};
