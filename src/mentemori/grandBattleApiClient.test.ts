import assert from "node:assert/strict";
import test from "node:test";
import { fetchGrandBattleLatest, fetchGrandBattleWorldGroups } from "./grandBattleApiClient.js";

test("fetches and normalizes Grand Battle world groups", async () => {
  const fetchMock = async (input: string | URL | Request): Promise<Response> => {
    assert.equal(String(input), "https://api.mentemori.icu/wgroups");
    return new Response(
      JSON.stringify({
        status: 200,
        data: [{ group_id: "12", worlds: ["1050", 1051] }],
      }),
      { status: 200 },
    );
  };

  const result = await fetchGrandBattleWorldGroups(fetchMock as typeof fetch);

  assert.deepEqual(result, [{ groupId: 12, worlds: [1050, 1051] }]);
});

test("fetches and normalizes Grand Battle latest response", async () => {
  const fetchMock = async (input: string | URL | Request): Promise<Response> => {
    assert.equal(String(input), "https://api.mentemori.icu/wg/12/globalgvg/3/2/latest");
    return new Response(
      JSON.stringify({
        status: 200,
        data: {
          guilds: {
            "111111111050": "Guild A",
          },
          castles: [
            {
              GuildId: 111111111050,
              AttackerGuildId: "222222222050",
            },
          ],
        },
      }),
      { status: 200 },
    );
  };

  const result = await fetchGrandBattleLatest(
    {
      worldGroupId: 12,
      classId: 3,
      blockId: 2,
    },
    fetchMock as typeof fetch,
  );

  assert.deepEqual(result, {
    guilds: {
      "111111111050": "Guild A",
    },
    castles: [
      {
        GuildId: "111111111050",
        AttackerGuildId: "222222222050",
      },
    ],
  });
});
