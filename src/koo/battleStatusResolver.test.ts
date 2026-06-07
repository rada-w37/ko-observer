import assert from "node:assert/strict";
import test from "node:test";
import { resolveBattleStatus } from "./battleStatusResolver.js";
import type { LocalGvgCastle } from "../mentemori/types.js";

test("resolves battle inactive when all castles are inactive", () => {
  const castles: LocalGvgCastle[] = [
    {
      gvgCastleState: 0,
    },
  ];

  const result = resolveBattleStatus(castles, "w1");

  assert.equal(result.isGuildBattleActive, false);
  assert.equal(result.battleType, "unknown");
  assert.deepEqual(result.scope, {
    type: "unknown",
    id: "w1",
  });
});

test("resolves battle active when any castle state is active", () => {
  const castles: LocalGvgCastle[] = [
    {
      gvgCastleState: 0,
    },
    {
      gvgCastleState: 2,
    },
  ];

  const result = resolveBattleStatus(castles, "w1");

  assert.equal(result.isGuildBattleActive, true);
  assert.equal(result.battleType, "guildBattle");
  assert.deepEqual(result.scope, {
    type: "world",
    id: "w1",
  });
});

test("keeps unknown GvgCastleState values out of active resolution", () => {
  const castles: LocalGvgCastle[] = [
    {
      gvgCastleState: 9,
    },
  ];

  const result = resolveBattleStatus(castles, "w1");

  assert.equal(result.isGuildBattleActive, false);
  assert.deepEqual(result.unknownGvgCastleStates, [9]);
});
