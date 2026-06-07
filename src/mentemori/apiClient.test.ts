import assert from "node:assert/strict";
import test from "node:test";
import { fetchLatestLocalGvg } from "./apiClient.js";

test("fetches and normalizes localgvg/latest response", async () => {
  const fetchMock = async (): Promise<Response> =>
    new Response(
      JSON.stringify([
        {
          GvgCastleState: 1,
          Guild: {
            GuildId: 100,
            GuildName: "Defender",
          },
          AttackerGuild: {
            GuildId: 200,
            GuildName: "Attacker",
          },
        },
      ]),
      {
        status: 200,
      },
    );

  const result = await fetchLatestLocalGvg("w1", fetchMock as typeof fetch);

  assert.equal(result.castles.length, 1);
  assert.equal(result.castles[0]?.gvgCastleState, 1);
  assert.deepEqual(result.castles[0]?.defenderGuild, {
    guildId: "100",
    guildName: "Defender",
  });
  assert.deepEqual(result.castles[0]?.attackerGuild, {
    guildId: "200",
    guildName: "Attacker",
  });
});

test("throws on API failure", async () => {
  const fetchMock = async (): Promise<Response> =>
    new Response("not found", {
      status: 404,
    });

  await assert.rejects(
    () => fetchLatestLocalGvg("w1", fetchMock as typeof fetch),
    /status=404/,
  );
});

test("throws on unexpected response shape", async () => {
  const fetchMock = async (): Promise<Response> =>
    new Response(JSON.stringify({ unexpected: true }), {
      status: 200,
    });

  await assert.rejects(
    () => fetchLatestLocalGvg("w1", fetchMock as typeof fetch),
    /Unexpected localgvg\/latest response shape/,
  );
});
