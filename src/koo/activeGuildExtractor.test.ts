import assert from "node:assert/strict";
import test from "node:test";
import { extractActiveGuilds } from "./activeGuildExtractor.js";
import type { LocalGvgCastle } from "../mentemori/types.js";

test("extracts defender only active guild", () => {
  const castles: LocalGvgCastle[] = [
    {
      gvgCastleState: 1,
      defenderGuild: {
        guildId: "g1",
        guildName: "Defender",
      },
    },
  ];

  const activeGuilds = extractActiveGuilds(castles);

  assert.equal(activeGuilds.g1.role, "defender");
  assert.equal(activeGuilds.g1.baselineKoCount, 0);
});

test("extracts attacker only active guild", () => {
  const castles: LocalGvgCastle[] = [
    {
      gvgCastleState: 1,
      attackerGuild: {
        guildId: "g2",
        guildName: "Attacker",
      },
    },
  ];

  const activeGuilds = extractActiveGuilds(castles);

  assert.equal(activeGuilds.g2.role, "attacker");
  assert.equal(activeGuilds.g2.koCount, 0);
});

test("marks duplicated defender and attacker as both", () => {
  const castles: LocalGvgCastle[] = [
    {
      gvgCastleState: 1,
      defenderGuild: {
        guildId: "g3",
        guildName: "Both",
      },
      attackerGuild: {
        guildId: "g3",
        guildName: "Both",
      },
    },
  ];

  const activeGuilds = extractActiveGuilds(castles);

  assert.equal(activeGuilds.g3.role, "both");
});

test("uses guildName key as Phase1 provisional fallback when guildId is missing", () => {
  const castles: LocalGvgCastle[] = [
    {
      gvgCastleState: 1,
      defenderGuild: {
        guildName: "NameOnly",
      },
    },
  ];

  const activeGuilds = extractActiveGuilds(castles);

  assert.equal(activeGuilds.NameOnly.guildId, "NameOnly");
  assert.equal(activeGuilds.NameOnly.role, "defender");
});
