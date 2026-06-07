export const GVG_CASTLE_STATE = {
  inactive: 0,
  activeDeclared: 1,
  activeBattle: 2,
  activeOccupied: 3,
  activeOther: 4,
} as const;

export type GvgCastleState = (typeof GVG_CASTLE_STATE)[keyof typeof GVG_CASTLE_STATE];

export type LocalGvgGuild = {
  guildId?: string;
  guildName: string;
};

export type LocalGvgCastle = {
  gvgCastleState: number;
  defenderGuild?: LocalGvgGuild;
  attackerGuild?: LocalGvgGuild;
};

export type LocalGvgLatest = {
  castles: LocalGvgCastle[];
};
