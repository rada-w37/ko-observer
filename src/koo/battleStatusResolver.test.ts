import assert from "node:assert/strict";
import test from "node:test";
import { resolveBattleStatus } from "./battleStatusResolver.js";
import type { LocalGvgCastle } from "../mentemori/types.js";

test("resolves battle inactive when all castles are inactive", () => {
  const result = resolveBattleStatus([createCastle(0)], "1001");

  assert.equal(result.isGuildBattleActive, false);
  assert.equal(result.battleType, "unknown");
  assert.deepEqual(result.scope, {
    type: "unknown",
    id: "1001",
  });
});

test("resolves battle active when any castle state is active", () => {
  const result = resolveBattleStatus([createCastle(0), createCastle(2)], "1001");

  assert.equal(result.isGuildBattleActive, true);
  assert.equal(result.battleType, "guildBattle");
  assert.deepEqual(result.scope, {
    type: "world",
    id: "1001",
  });
});

test("keeps unknown GvgCastleState values out of active resolution", () => {
  const unknownStateCastle = { ...createCastle(0), GvgCastleState: 9 } as unknown as LocalGvgCastle;
  const result = resolveBattleStatus([unknownStateCastle], "1001");

  assert.equal(result.isGuildBattleActive, false);
  assert.deepEqual(result.unknownGvgCastleStates, [9]);
});

function createCastle(GvgCastleState: number): LocalGvgCastle {
  return {
    CastleId: 1,
    GuildId: 100001,
    AttackerGuildId: 0,
    DefensePartyCount: 120,
    GvgCastleState,
    LastWinPartyKnockOutCount: 0,
  } as LocalGvgCastle;
}
