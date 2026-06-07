import assert from "node:assert/strict";
import test from "node:test";
import { extractActiveGuilds } from "./activeGuildExtractor.js";
import type { ActiveGuild } from "./activeGuildExtractor.js";
import type { LocalGvgLatest } from "../mentemori/types.js";

test("extracts defender castle observations", () => {
  const activeGuilds = extractActiveGuilds(createLocalGvgLatest([
    {
      CastleId: 1,
      GuildId: 100001,
      AttackerGuildId: 0,
      DefensePartyCount: 120,
      GvgCastleState: 1,
      LastWinPartyKnockOutCount: 7,
    },
  ]));

  assert.equal(activeGuilds["100001"]?.role, "defender");
  assert.equal(activeGuilds["100001"]?.guildName, "Defender");
  assert.deepEqual(activeGuilds["100001"]?.castles.defending, [
    {
      castleId: 1,
      gvgCastleState: 1,
      rawLastWinPartyKnockOutCount: 7,
      lastWinPartyDefeatedCount: 7,
    },
  ]);
  assert.deepEqual(activeGuilds["100001"]?.castles.attacking, []);
});

test("extracts attacker castle observations", () => {
  const activeGuilds = extractActiveGuilds(createLocalGvgLatest([
    {
      CastleId: 2,
      GuildId: 0,
      AttackerGuildId: 200001,
      DefensePartyCount: 0,
      GvgCastleState: 1,
      LastWinPartyKnockOutCount: 3,
    },
  ]));

  assert.equal(activeGuilds["200001"]?.role, "attacker");
  assert.equal(activeGuilds["200001"]?.guildName, "Attacker");
  assert.deepEqual(activeGuilds["200001"]?.castles.defending, []);
  assert.deepEqual(activeGuilds["200001"]?.castles.attacking, [
    {
      castleId: 2,
      gvgCastleState: 1,
      rawLastWinPartyKnockOutCount: 3,
      lastWinPartyDefeatedCount: 3,
    },
  ]);
});

test("marks duplicated defender and attacker as both with both castle lists", () => {
  const activeGuilds = extractActiveGuilds(createLocalGvgLatest([
    {
      CastleId: 3,
      GuildId: 300001,
      AttackerGuildId: 300001,
      DefensePartyCount: 120,
      GvgCastleState: 2,
      LastWinPartyKnockOutCount: 11,
    },
  ]));

  assert.equal(activeGuilds["300001"]?.role, "both");
  assert.equal(activeGuilds["300001"]?.castles.defending.length, 1);
  assert.equal(activeGuilds["300001"]?.castles.attacking.length, 1);
});

test("ignores zero guild ids", () => {
  const activeGuilds = extractActiveGuilds(createLocalGvgLatest([
    {
      CastleId: 4,
      GuildId: 0,
      AttackerGuildId: 0,
      DefensePartyCount: 0,
      GvgCastleState: 0,
      LastWinPartyKnockOutCount: 0,
    },
  ]));

  assert.deepEqual(activeGuilds, {});
});

test("uses provisional guild name when guilds map does not contain the guildId", () => {
  const activeGuilds = extractActiveGuilds({
    worldId: 1001,
    guilds: {},
    castles: [
      {
        CastleId: 5,
        GuildId: 400001,
        AttackerGuildId: 0,
        DefensePartyCount: 120,
        GvgCastleState: 1,
        LastWinPartyKnockOutCount: 2,
      },
    ],
  });

  assert.equal(activeGuilds["400001"]?.guildId, "400001");
  assert.equal(activeGuilds["400001"]?.guildName, "Guild 400001");
});

test("does not add guild-level KO aggregate fields", () => {
  const activeGuilds = extractActiveGuilds(createLocalGvgLatest([
    {
      CastleId: 6,
      GuildId: 100001,
      AttackerGuildId: 0,
      DefensePartyCount: 120,
      GvgCastleState: 1,
      LastWinPartyKnockOutCount: 5,
    },
  ]));

  const activeGuild = activeGuilds["100001"] as ActiveGuild & Record<string, unknown>;

  assert.equal("baselineKoCount" in activeGuild, false);
  assert.equal("koCount" in activeGuild, false);
  assert.equal("currentRawKoCount" in activeGuild, false);
  assert.equal("baselineDefeatedCount" in activeGuild, false);
  assert.equal("currentRawDefeatedCount" in activeGuild, false);
  assert.equal("defeatedCount" in activeGuild, false);
});

function createLocalGvgLatest(castles: LocalGvgLatest["castles"]): LocalGvgLatest {
  return {
    worldId: 1001,
    guilds: {
      "100001": "Defender",
      "200001": "Attacker",
      "300001": "Both",
    },
    castles,
  };
}
