import assert from "node:assert/strict";
import test from "node:test";
import { extractActiveGuilds } from "./activeGuildExtractor.js";
import type { LocalGvgLatest } from "../mentemori/types.js";

test("extracts defender only active guild", () => {
  const activeGuilds = extractActiveGuilds(createLocalGvgLatest([
    {
      CastleId: 1,
      GuildId: 100001,
      AttackerGuildId: 0,
      DefensePartyCount: 120,
      GvgCastleState: 1,
      LastWinPartyKnockOutCount: 0,
    },
  ]));

  assert.equal(activeGuilds["100001"]?.role, "defender");
  assert.equal(activeGuilds["100001"]?.guildName, "Defender");
  assert.equal(activeGuilds["100001"]?.baselineKoCount, 0);
});

test("extracts attacker only active guild", () => {
  const activeGuilds = extractActiveGuilds(createLocalGvgLatest([
    {
      CastleId: 1,
      GuildId: 0,
      AttackerGuildId: 200001,
      DefensePartyCount: 0,
      GvgCastleState: 1,
      LastWinPartyKnockOutCount: 0,
    },
  ]));

  assert.equal(activeGuilds["200001"]?.role, "attacker");
  assert.equal(activeGuilds["200001"]?.guildName, "Attacker");
  assert.equal(activeGuilds["200001"]?.koCount, 0);
});

test("marks duplicated defender and attacker as both", () => {
  const activeGuilds = extractActiveGuilds(createLocalGvgLatest([
    {
      CastleId: 1,
      GuildId: 300001,
      AttackerGuildId: 300001,
      DefensePartyCount: 120,
      GvgCastleState: 1,
      LastWinPartyKnockOutCount: 0,
    },
  ]));

  assert.equal(activeGuilds["300001"]?.role, "both");
});

test("uses provisional guild name when guilds map does not contain the guildId", () => {
  const activeGuilds = extractActiveGuilds({
    worldId: 1001,
    guilds: {},
    castles: [
      {
        CastleId: 1,
        GuildId: 400001,
        AttackerGuildId: 0,
        DefensePartyCount: 120,
        GvgCastleState: 1,
        LastWinPartyKnockOutCount: 0,
      },
    ],
  });

  assert.equal(activeGuilds["400001"]?.guildId, "400001");
  assert.equal(activeGuilds["400001"]?.guildName, "Guild 400001");
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
