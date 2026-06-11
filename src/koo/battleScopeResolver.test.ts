import assert from "node:assert/strict";
import test from "node:test";
import { resolveBattleSubscriptionScope } from "./battleScopeResolver.js";

test("resolves Guild Battle scope when localgvg is active without guildId", async () => {
  const result = await resolveBattleSubscriptionScope(
    {
      worldId: "1001",
    },
    createFetchMock({
      localGvgState: 2,
    }) as typeof fetch,
  );

  assert.deepEqual(result, {
    battleType: "guildBattle",
    subscriptionType: "guildBattle",
    worldId: "1001",
    guildId: null,
    worldGroupId: null,
    classId: null,
    blockId: null,
  });
});

test("resolves Grand Battle class and block by guildId", async () => {
  const requestedUrls: string[] = [];
  const result = await resolveBattleSubscriptionScope(
    {
      worldId: "1050",
      guildId: "111111111050",
    },
    createFetchMock({
      localGvgState: 0,
      requestedUrls,
      matchingClassId: 2,
      matchingBlockId: 1,
      matchingGuildId: "111111111050",
    }) as typeof fetch,
  );

  assert.deepEqual(result, {
    battleType: "grandBattle",
    subscriptionType: "grandBattle",
    worldId: "1050",
    guildId: "111111111050",
    worldGroupId: 12,
    classId: 2,
    blockId: 1,
  });
  assert.ok(requestedUrls.includes("https://api.mentemori.icu/wgroups"));
  assert.ok(requestedUrls.includes("https://api.mentemori.icu/wg/12/globalgvg/2/1/latest"));
});

test("resolves Grand Battle class and block by castle guildId", async () => {
  const result = await resolveBattleSubscriptionScope(
    {
      worldId: "1050",
      guildId: "222222222050",
    },
    createFetchMock({
      localGvgState: 0,
      matchingClassId: 3,
      matchingBlockId: 2,
      matchingGuildId: "222222222050",
      matchInCastle: true,
    }) as typeof fetch,
  );

  assert.equal(result.battleType, "grandBattle");
  assert.equal(result.classId, 3);
  assert.equal(result.blockId, 2);
});

test("returns unresolved scope with worldGroupId when guild is not in Grand Battle blocks", async () => {
  const result = await resolveBattleSubscriptionScope(
    {
      worldId: "1050",
      guildId: "999999999050",
    },
    createFetchMock({
      localGvgState: 0,
    }) as typeof fetch,
  );

  assert.equal(result.battleType, "unknown");
  assert.equal(result.subscriptionType, "none");
  assert.equal(result.worldGroupId, 12);
  assert.match(result.reason, /class\/block was not found/);
});

test("returns unresolved scope when Grand Battle search needs guildId", async () => {
  const result = await resolveBattleSubscriptionScope(
    {
      worldId: "1050",
    },
    createFetchMock({
      localGvgState: 0,
    }) as typeof fetch,
  );

  assert.equal(result.battleType, "unknown");
  assert.equal(result.subscriptionType, "none");
  assert.match(result.reason, /KOO_GUILD_ID is required/);
});

function createFetchMock(options: {
  localGvgState: number;
  requestedUrls?: string[];
  matchingClassId?: number;
  matchingBlockId?: number;
  matchingGuildId?: string;
  matchInCastle?: boolean;
}) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    options.requestedUrls?.push(url);

    if (url.endsWith("/localgvg/latest")) {
      return createJsonResponse({
        status: 200,
        timestamp: 1780821188,
        data: {
          world_id: 1050,
          guilds: {
            "100001": "Guild",
          },
          castles: [
            {
              CastleId: 1,
              GuildId: 100001,
              AttackerGuildId: 0,
              DefensePartyCount: 120,
              GvgCastleState: options.localGvgState,
              LastWinPartyKnockOutCount: 0,
            },
          ],
        },
      });
    }

    if (url.endsWith("/wgroups")) {
      return createJsonResponse({
        status: 200,
        data: [{ group_id: 12, worlds: [1050] }],
      });
    }

    const match = url.match(/globalgvg\/(\d+)\/(\d+)\/latest$/);
    if (match) {
      const classId = Number(match[1]);
      const blockId = Number(match[2]);
      const hasMatch =
        classId === options.matchingClassId && blockId === options.matchingBlockId;
      return createJsonResponse({
        status: 200,
        data: {
          guilds:
            hasMatch && options.matchingGuildId && !options.matchInCastle
              ? { [options.matchingGuildId]: "Guild" }
              : {},
          castles:
            hasMatch && options.matchingGuildId && options.matchInCastle
              ? [{ GuildId: "0", AttackerGuildId: options.matchingGuildId }]
              : [],
        },
      });
    }

    return new Response("not found", { status: 404 });
  };
}

function createJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}
