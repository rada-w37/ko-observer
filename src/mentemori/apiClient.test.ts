import assert from "node:assert/strict";
import test from "node:test";
import { fetchLatestLocalGvg } from "./apiClient.js";

test("fetches and normalizes localgvg/latest response", async () => {
  const fetchMock = async (): Promise<Response> =>
    new Response(
      JSON.stringify({
        status: 200,
        timestamp: 1780821188,
        data: {
          world_id: 1001,
          castles: [
            {
              CastleId: 1,
              GuildId: 100001,
              AttackerGuildId: 200001,
              AttackPartyCount: 0,
              DefensePartyCount: 120,
              GvgCastleState: 1,
              UtcFallenTimeStamp: 0,
              LastWinPartyKnockOutCount: 0,
            },
          ],
          guilds: {
            "100001": "Defender",
            "200001": "Attacker",
          },
        },
      }),
      {
        status: 200,
      },
    );

  const result = await fetchLatestLocalGvg("1001", fetchMock as typeof fetch);

  assert.equal(result.worldId, 1001);
  assert.deepEqual(result.guilds, {
    "100001": "Defender",
    "200001": "Attacker",
  });
  assert.equal(result.castles.length, 1);
  assert.deepEqual(result.castles[0], {
    CastleId: 1,
    GuildId: 100001,
    AttackerGuildId: 200001,
    DefensePartyCount: 120,
    GvgCastleState: 1,
    LastWinPartyKnockOutCount: 0,
  });
});

test("throws on API failure", async () => {
  const fetchMock = async (): Promise<Response> =>
    new Response("not found", {
      status: 404,
    });

  await assert.rejects(
    () => fetchLatestLocalGvg("1001", fetchMock as typeof fetch),
    /status=404/,
  );
});

test("throws on unexpected response shape", async () => {
  const fetchMock = async (): Promise<Response> =>
    new Response(JSON.stringify({ unexpected: true }), {
      status: 200,
    });

  await assert.rejects(
    () => fetchLatestLocalGvg("1001", fetchMock as typeof fetch),
    /Unexpected localgvg\/latest response envelope/,
  );
});
