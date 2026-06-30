import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCastleName,
  resolveCastleNameOrFallback,
  UNKNOWN_CASTLE_NAME,
} from "./castleName.js";

test("resolves Guild Battle castle names from static metadata", () => {
  assert.equal(resolveCastleName("guildBattle", 1), "ブラッセル");
  assert.equal(resolveCastleName("guildBattle", 12), "シャルルロア");
  assert.equal(resolveCastleName("guildBattle", 21), "バーフ");
});

test("resolves Grand Battle castle names from static metadata", () => {
  assert.equal(resolveCastleName("grandBattle", 1), "アイン");
  assert.equal(resolveCastleName("grandBattle", 12), "ラピス");
  assert.equal(resolveCastleName("grandBattle", 21), "ルラ");
});

test("falls back without exposing castle id in display name", () => {
  assert.equal(resolveCastleName("guildBattle", 999), null);
  assert.equal(resolveCastleNameOrFallback("grandBattle", 999), UNKNOWN_CASTLE_NAME);
  assert.equal(resolveCastleNameOrFallback("grandBattle", 999).includes("999"), false);
});
