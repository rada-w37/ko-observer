import type { NotificationBattleType } from "./notificationDomain.js";

export const UNKNOWN_CASTLE_NAME = "名称不明の拠点";

const GUILD_BATTLE_CASTLE_NAMES: Readonly<Record<number, string>> = {
  1: "ブラッセル",
  2: "ウィスケルケー",
  3: "モダーヴ",
  4: "シメイ",
  5: "グラベンスティン",
  6: "カンブル",
  7: "クインティヌス",
  8: "ランベール",
  9: "サンジャック",
  10: "ミヒャエル",
  11: "ナミュール",
  12: "シャルルロア",
  13: "アルゼット",
  14: "エノー",
  15: "ワーヴル",
  16: "モンス",
  17: "クリストフ",
  18: "コルトレイク",
  19: "イーペル",
  20: "サルヴァトール",
  21: "バーフ",
};

const GRAND_BATTLE_CASTLE_NAMES: Readonly<Record<number, string>> = {
  1: "アイン",
  2: "イエソド",
  3: "マルクト",
  4: "ケテル",
  5: "テファレト",
  6: "クシェル",
  7: "シトリ",
  8: "トパズ",
  9: "メラル",
  10: "ペリド",
  11: "ファリア",
  12: "ラピス",
  13: "ラリマル",
  14: "マリン",
  15: "アメト",
  16: "ラペン",
  17: "ジルコン",
  18: "オニキス",
  19: "フロライト",
  20: "ガネット",
  21: "ルラ",
};

export function resolveCastleName(
  battleType: NotificationBattleType,
  castleId: number,
): string | null {
  const castleNames =
    battleType === "guildBattle" ? GUILD_BATTLE_CASTLE_NAMES : GRAND_BATTLE_CASTLE_NAMES;
  return castleNames[castleId] ?? null;
}

export function resolveCastleNameOrFallback(
  battleType: NotificationBattleType,
  castleId: number,
): string {
  return resolveCastleName(battleType, castleId) ?? UNKNOWN_CASTLE_NAME;
}
