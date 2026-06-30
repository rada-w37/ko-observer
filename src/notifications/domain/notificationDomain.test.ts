import assert from "node:assert/strict";
import test from "node:test";
import {
  compareNotificationRulePriority,
  createFallbackBaseName,
  deriveBattleSideFromCastleStatus,
  evaluateNotificationRule,
  parseStartTimeMinutes,
  type NotificationObservation,
  type NotificationRule,
} from "./notificationDomain.js";

test("skips disabled and battle type mismatch rules", () => {
  const observation = createObservation();

  assert.deepEqual(evaluateNotificationRule({ ...createRule(), enabled: false }, observation), {
    status: "skipped",
    reason: "disabled",
  });
  assert.deepEqual(
    evaluateNotificationRule({ ...createRule(), battleType: "grandBattle" }, observation),
    {
      status: "skipped",
      reason: "battle_type_mismatch",
    },
  );
});

test("compares schedule start and end time by JST minutes", () => {
  const rule = createRule({
    schedule: {
      startTime: "20:55",
      endTime: "20:56",
    },
  });

  assert.deepEqual(
    evaluateNotificationRule(
      rule,
      createObservation({ observedAt: new Date("2026-06-17T11:54:00.000Z") }),
    ),
    {
      status: "skipped",
      reason: "before_start_time",
    },
  );
  assert.equal(
    evaluateNotificationRule(
      rule,
      createObservation({ observedAt: new Date("2026-06-17T11:55:00.000Z") }),
    ).status,
    "matched",
  );
  assert.equal(
    evaluateNotificationRule(
      rule,
      createObservation({ observedAt: new Date("2026-06-17T11:56:00.000Z") }),
    ).status,
    "matched",
  );
  assert.deepEqual(
    evaluateNotificationRule(
      rule,
      createObservation({ observedAt: new Date("2026-06-17T11:57:00.000Z") }),
    ),
    {
      status: "skipped",
      reason: "after_end_time",
    },
  );
});

test("evaluates detail condition root OR and groups", () => {
  const rule = createRule({
    detailConditions: {
      operator: "OR",
      children: [
        {
          type: "condition",
          field: "attackCount",
          operator: ">=",
          value: 10,
        },
        {
          type: "group",
          operator: "AND",
          children: [
            {
              type: "condition",
              field: "defenseCount",
              operator: "<=",
              value: 3,
            },
            {
              type: "condition",
              field: "attackCount",
              operator: ">=",
              value: 2,
            },
          ],
        },
      ],
    },
  });

  assert.deepEqual(evaluateNotificationRule(rule, createObservation({ attackCount: 1 })), {
    status: "skipped",
    reason: "detail_conditions_not_matched",
  });
  assert.equal(
    evaluateNotificationRule(rule, createObservation({ defenseCount: 3, attackCount: 2 })).status,
    "matched",
  );
  assert.equal(
    evaluateNotificationRule(rule, createObservation({ defenseCount: 99, attackCount: 10 })).status,
    "matched",
  );
});

test("filters target guild ids only for Guild Battle", () => {
  const rule = createRule({
    targetGuildIds: ["target-guild"],
  });

  assert.equal(
    evaluateNotificationRule(
      rule,
      createObservation({ attackerGuildId: "target-guild" }),
    ).status,
    "matched",
  );
  assert.deepEqual(
    evaluateNotificationRule(rule, createObservation({ attackerGuildId: "other-guild" })),
    {
      status: "skipped",
      reason: "target_guild_not_matched",
    },
  );
  assert.deepEqual(evaluateNotificationRule(rule, createObservation({ attackerGuildId: null })), {
    status: "skipped",
    reason: "target_guild_not_matched",
  });
  assert.equal(
    evaluateNotificationRule(createRule({ targetGuildIds: [] }), createObservation()).status,
    "matched",
  );
});

test("uses observedAt for temporary suspension expiry", () => {
  const future = createRule({
    temporarySuspension: {
      expiresAt: "2026-06-17T12:00:00.000Z",
    },
  });
  const expired = createRule({
    temporarySuspension: {
      expiresAt: "2026-06-17T11:00:00.000Z",
    },
  });

  assert.deepEqual(evaluateNotificationRule(future, createObservation()), {
    status: "skipped",
    reason: "temporary_suspended",
  });
  assert.equal(evaluateNotificationRule(expired, createObservation()).status, "matched");
});

test("renders templates and mention text", () => {
  const result = evaluateNotificationRule(
    createRule({
      message: {
        usernameTemplate: "{通知ルール名}",
        mention: { type: "custom", customText: "<@123> " },
        titleTemplate: "{拠点名} {侵攻ギルド}",
        bodyTemplate: "{防御数}/{侵攻数} {通知時刻}",
      },
    }),
    createObservation(),
  );

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(result.request.message.username, "Rule A");
  assert.equal(result.request.message.mentionText, "<@123>");
  assert.equal(result.request.message.title, "ブラッセル Attacker A");
  assert.equal(result.request.message.body, "2/5 20:55");
});

test("creates stable request id and duplicate key components", () => {
  const rule = createRule();
  const withId = evaluateNotificationRule(rule, createObservation());
  const withIdAgain = evaluateNotificationRule(rule, createObservation());
  const unknown = evaluateNotificationRule(
    rule,
    createObservation({ attackerGuildId: null, attackerGuildName: null }),
  );

  assert.equal(withId.status, "matched");
  assert.equal(withIdAgain.status, "matched");
  assert.equal(unknown.status, "matched");
  if (withId.status !== "matched" || withIdAgain.status !== "matched" || unknown.status !== "matched") {
    return;
  }

  assert.equal(withId.requestId, withIdAgain.requestId);
  assert.equal(
    withId.request.duplicateKey,
    "111111111001:guildBattle:1001:2026-06-17:rule-a:castle-1:222222222001",
  );
  assert.equal(
    unknown.request.duplicateKey,
    "111111111001:guildBattle:1001:2026-06-17:rule-a:castle-1:no-attacker",
  );
  assert.equal(unknown.request.attackerGuildName, "不明");
});

test("filters rules by battleSide derived from castle status", () => {
  assert.equal(
    evaluateNotificationRule(createRule({ battleSide: "defense" }), createObservation()).status,
    "matched",
  );
  assert.deepEqual(
    evaluateNotificationRule(
      createRule({ battleSide: "attack" }),
      createObservation({
        ownerGuildId: "111111111001",
        attackerGuildId: "111111111001",
      }),
    ),
    {
      status: "skipped",
      reason: "battle_side_defense",
    },
  );
  assert.equal(
    evaluateNotificationRule(
      createRule({ battleSide: "attack", targetGuildIds: ["111111111001"] }),
      createObservation({
        ownerGuildId: "222222222001",
        attackerGuildId: "111111111001",
        attackerGuildName: "Own Guild",
      }),
    ).status,
    "matched",
  );
  assert.deepEqual(
    evaluateNotificationRule(
      createRule({ battleSide: "defense" }),
      createObservation({
        ownerGuildId: "333333333001",
        attackerGuildId: "222222222001",
      }),
    ),
    {
      status: "skipped",
      reason: "battle_side_unrelated",
    },
  );
});

test("derives battle side from owner and attacker guild in castle status", () => {
  assert.equal(
    deriveBattleSideFromCastleStatus({
      ownGuildId: "guild-a",
      ownerGuildId: "guild-a",
      attackerGuildId: "guild-a",
      attackCount: 2,
    }),
    "defense",
  );
  assert.equal(
    deriveBattleSideFromCastleStatus({
      ownGuildId: "guild-a",
      ownerGuildId: "guild-b",
      attackerGuildId: "guild-a",
      attackCount: 2,
    }),
    "attack",
  );
  assert.equal(
    deriveBattleSideFromCastleStatus({
      ownGuildId: "guild-a",
      ownerGuildId: "guild-b",
      attackerGuildId: "guild-c",
      attackCount: 2,
    }),
    "unrelated",
  );
  assert.equal(
    deriveBattleSideFromCastleStatus({
      ownGuildId: "guild-a",
      ownerGuildId: "guild-a",
      attackerGuildId: "guild-b",
      attackCount: 0,
    }),
    "unrelated",
  );
});

test("sorts rule priority by later start, sortOrder, then id", () => {
  const later = createRule({ id: "rule-b", schedule: { startTime: "21:10", endTime: null } });
  const earlier = createRule({ id: "rule-a", schedule: { startTime: "21:00", endTime: null } });
  const lowerSortOrder = createRule({ id: "rule-c", sortOrder: 1 });
  const higherSortOrder = createRule({ id: "rule-d", sortOrder: 2 });
  const lowerId = createRule({ id: "rule-e", sortOrder: 1 });
  const higherId = createRule({ id: "rule-f", sortOrder: 1 });

  assert.equal(compareNotificationRulePriority(later, earlier) < 0, true);
  assert.equal(compareNotificationRulePriority(lowerSortOrder, higherSortOrder) < 0, true);
  assert.equal(compareNotificationRulePriority(lowerId, higherId) < 0, true);
});

test("parses start time and creates fallback base name", () => {
  assert.equal(parseStartTimeMinutes("00:00"), 0);
  assert.equal(parseStartTimeMinutes("23:59"), 1439);
  assert.equal(parseStartTimeMinutes("24:00"), null);
  assert.equal(parseStartTimeMinutes("9:00"), null);
  assert.equal(createFallbackBaseName(12), "名称不明の拠点");
});

function createRule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "rule-a",
    schemaVersion: 2,
    battleType: "guildBattle",
    battleSide: "defense",
    name: "Rule A",
    enabled: true,
    sortOrder: 1,
    schedule: {
      startTime: "20:50",
      endTime: null,
    },
    targetGuildIds: [],
    detailConditions: {
      operator: "OR",
      children: [
        {
          type: "condition",
          field: "defenseCount",
          operator: "<=",
          value: 999,
        },
      ],
    },
    message: {
      usernameTemplate: "KOO",
      mention: { type: "none" },
      titleTemplate: "{拠点名}",
      bodyTemplate: "{通知ルール名}",
    },
    ...overrides,
  };
}

function createObservation(
  overrides: Partial<NotificationObservation> = {},
): NotificationObservation {
  return {
    guildId: "111111111001",
    battleType: "guildBattle",
    castleId: 1,
    castleName: "ブラッセル",
    ownerGuildId: "111111111001",
    attackerGuildId: "222222222001",
    attackerGuildName: "Attacker A",
    defenseCount: 2,
    attackCount: 5,
    observedAt: new Date("2026-06-17T11:55:00.000Z"),
    worldId: "1001",
    runId: "run-a",
    ...overrides,
  };
}
