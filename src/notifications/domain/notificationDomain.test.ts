import assert from "node:assert/strict";
import test from "node:test";
import { GVG_CASTLE_STATE } from "../../mentemori/types.js";
import {
  compareNotificationRulePriority,
  createFallbackBaseName,
  createNotificationRequestId,
  createRepeatNotificationRequestId,
  deriveBattleSideFromCastleStatus,
  evaluateNotificationRule,
  evaluateRuleLevelNotification,
  parseStartTimeMinutes,
  resolveEffectiveRepeatNotification,
  resolveDisplayGuildSides,
  type NotificationObservation,
  type NotificationRule,
  type NotificationRuleTick,
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

test("creates rule-level notification for detail-rule-off rules in active time", () => {
  const result = evaluateRuleLevelNotification(
    createRule({
      detailRuleEnabled: false,
      message: {
        usernameTemplate: "{通知ルール名}",
        mention: { type: "none" },
        titleTemplate: "定時 {通知時刻}",
        bodyTemplate: "body",
      },
    }),
    createRuleTick(),
  );

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(result.request.detailRuleEnabled, false);
  assert.equal(result.request.activeTimeWindow, "20:50-open");
  assert.equal(result.request.message.username, "Rule A");
  assert.equal(result.request.message.title, "定時 20:55");
  assert.equal(result.request.baseId, undefined);
  assert.equal(result.request.attackGuildId, undefined);
  assert.equal(
    result.request.duplicateKey,
    "111111111001:guildBattle:1001:2026-06-17:rule-a:time:20:50-open",
  );
});

test("skips rule-level notification outside active time and with detail-only variables", () => {
  assert.deepEqual(
    evaluateRuleLevelNotification(
      createRule({
        detailRuleEnabled: false,
      }),
      createRuleTick({ observedAt: new Date("2026-06-17T11:49:00.000Z") }),
    ),
    {
      status: "skipped",
      reason: "before_start_time",
    },
  );
  assert.deepEqual(
    evaluateRuleLevelNotification(
      createRule({
        detailRuleEnabled: false,
        message: {
          usernameTemplate: "",
          mention: { type: "none" },
          titleTemplate: "{拠点名}",
          bodyTemplate: "",
        },
      }),
      createRuleTick(),
    ),
    {
      status: "skipped",
      reason: "detail_rule_off_template_variables",
    },
  );
});

test("filters guildFilter by semantic attack or defense guild ids", () => {
  assert.equal(
    evaluateNotificationRule(
      createRule({ battleSide: "attack", guildFilter: ["111111111001"] }),
      createObservation({ attackGuildId: "111111111001", defenseGuildId: "other-guild" }),
    ).status,
    "matched",
  );
  assert.equal(
    evaluateNotificationRule(
      createRule({ battleSide: "defense", guildFilter: ["111111111001"] }),
      createObservation({ attackGuildId: "other-guild", defenseGuildId: "111111111001" }),
    ).status,
    "matched",
  );
  assert.deepEqual(
    evaluateNotificationRule(
      createRule({ guildFilter: ["target-guild"] }),
      createObservation(),
    ),
    {
      status: "skipped",
      reason: "target_guild_not_matched",
    },
  );
  assert.equal(
    evaluateNotificationRule(createRule({ guildFilter: [] }), createObservation()).status,
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
        bodyTemplate: "{防衛ギルド} {防衛数}/{侵攻数} {通知時刻}",
      },
    }),
    createObservation(),
  );

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(result.request.message.username, "Rule A");
  assert.equal(result.request.message.mentionText, "<@123>");
  assert.equal(result.request.message.title, "ブラッセル Attacker A");
  assert.equal(result.request.message.body, "Owner A 2/5 20:55");
});

test("renders attack and defense guild templates from gvg castle state", () => {
  const cases = [
    {
      name: "inBattle",
      gvgCastleState: GVG_CASTLE_STATE.activeDeclared,
      expectedTitle: "Attacker A/Owner A",
      expectedAttackGuildId: "222222222001",
      expectedDefenseGuildId: "111111111001",
    },
    {
      name: "fallen",
      gvgCastleState: GVG_CASTLE_STATE.activeBattle,
      expectedTitle: "Owner A/Attacker A",
      expectedAttackGuildId: "111111111001",
      expectedDefenseGuildId: "222222222001",
    },
    {
      name: "counterattack",
      gvgCastleState: GVG_CASTLE_STATE.activeCounterattack,
      expectedTitle: "Owner A/Attacker A",
      expectedAttackGuildId: "111111111001",
      expectedDefenseGuildId: "222222222001",
    },
    {
      name: "counterattackSuccessful",
      gvgCastleState: GVG_CASTLE_STATE.activeCounterattackSuccessful,
      expectedTitle: "不明/Owner A",
      expectedAttackGuildId: null,
      expectedDefenseGuildId: "111111111001",
    },
    {
      name: "idle",
      gvgCastleState: GVG_CASTLE_STATE.inactive,
      expectedTitle: "不明/Owner A",
      expectedAttackGuildId: null,
      expectedDefenseGuildId: "111111111001",
    },
    {
      name: "unknown",
      gvgCastleState: 99,
      expectedTitle: "不明/不明",
      expectedAttackGuildId: null,
      expectedDefenseGuildId: null,
    },
  ];

  for (const testCase of cases) {
    const result = evaluateNotificationRule(
      createRule({
        battleSide: testCase.expectedAttackGuildId === "111111111001" ? "attack" : "defense",
        message: {
          usernameTemplate: "",
          mention: { type: "none" },
          titleTemplate: "{侵攻ギルド}/{防衛ギルド}",
          bodyTemplate: testCase.name,
        },
      }),
      createObservation({
        gvgCastleState: testCase.gvgCastleState,
        ...resolveDisplayGuildSides({
          gvgCastleState: testCase.gvgCastleState,
          ownerGuildId: "111111111001",
          ownerGuildName: "Owner A",
          attackerGuildId: "222222222001",
          attackerGuildName: "Attacker A",
        }),
      }),
    );

    if (testCase.expectedAttackGuildId === null && testCase.expectedDefenseGuildId === null) {
      assert.deepEqual(
        resolveDisplayGuildSides({
          gvgCastleState: testCase.gvgCastleState,
          ownerGuildId: "111111111001",
          ownerGuildName: "Owner A",
          attackerGuildId: "222222222001",
          attackerGuildName: "Attacker A",
        }),
        {
          attackGuildId: null,
          attackGuildName: null,
          defenseGuildId: null,
          defenseGuildName: null,
        },
        testCase.name,
      );
      continue;
    }

    assert.equal(result.status, "matched");
    if (result.status !== "matched") return;
    assert.equal(result.request.message.title, testCase.expectedTitle, testCase.name);
    assert.equal(result.request.attackGuildId, testCase.expectedAttackGuildId, testCase.name);
    assert.equal(result.request.defenseGuildId, testCase.expectedDefenseGuildId, testCase.name);
  }
});

test("leaves old defense count template variable unchanged", () => {
  const result = evaluateNotificationRule(
    createRule({
      message: {
        usernameTemplate: "",
        mention: { type: "none" },
        titleTemplate: "{拠点名}",
        bodyTemplate: "{防御数}/{防衛数}",
      },
    }),
    createObservation(),
  );

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(result.request.message.body, "{防御数}/2");
});

test("allows empty body and username templates in rendered requests", () => {
  const result = evaluateNotificationRule(
    createRule({
      message: {
        usernameTemplate: "",
        mention: { type: "none" },
        titleTemplate: "title",
        bodyTemplate: "",
      },
    }),
    createObservation(),
  );

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(result.request.message.username, "");
  assert.equal(result.request.message.title, "title");
  assert.equal(result.request.message.body, "");
});

test("allows username templates that become blank after trimming", () => {
  const result = evaluateNotificationRule(
    createRule({
      message: {
        usernameTemplate: "   ",
        mention: { type: "none" },
        titleTemplate: "title",
        bodyTemplate: "body",
      },
    }),
    createObservation(),
  );

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(result.request.message.username.trim(), "");
});

test("normalizes rendered title to 120 chars when template expansion is longer", () => {
  const result = evaluateNotificationRule(
    createRule({
      name: "R".repeat(10),
      message: {
        usernameTemplate: "KOO",
        mention: { type: "none" },
        titleTemplate: `${"x".repeat(119)}{通知ルール名}`,
        bodyTemplate: "body",
      },
    }),
    createObservation(),
  );

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(result.request.message.title.length, 120);
  assert.equal(result.request.message.title, `${"x".repeat(119)}…`);
});

test("normalizes rendered title without breaking emoji surrogate pairs", () => {
  const result = evaluateNotificationRule(
    createRule({
      message: {
        usernameTemplate: "KOO",
        mention: { type: "none" },
        titleTemplate: `${"a".repeat(118)}😀bc`,
        bodyTemplate: "body",
      },
    }),
    createObservation(),
  );

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(Array.from(result.request.message.title).length, 120);
  assert.equal(result.request.message.title, `${"a".repeat(118)}😀…`);
  assert.equal(result.request.message.title.includes("�"), false);
});

test("keeps rendered title unchanged when it is within 120 chars", () => {
  const title = "x".repeat(120);
  const result = evaluateNotificationRule(
    createRule({
      message: {
        usernameTemplate: "KOO",
        mention: { type: "none" },
        titleTemplate: title,
        bodyTemplate: "body",
      },
    }),
    createObservation(),
  );

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(result.request.message.title, title);
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

test("keeps non-repeat request id unchanged and creates repeat request id from base key and sequence", () => {
  const result = evaluateNotificationRule(createRule(), createObservation());

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(result.requestId, createNotificationRequestId(result.request.duplicateKey));
  assert.equal(
    createRepeatNotificationRequestId(result.request.duplicateKey, 1),
    createNotificationRequestId(`${result.request.duplicateKey}|repeat|1`),
  );
});

test("resolves effective repeat notification only for detail rules with conditions and valid interval", () => {
  assert.deepEqual(
    resolveEffectiveRepeatNotification(
      createRule({ repeatNotification: { enabled: true, intervalSeconds: 60 } }),
    ),
    { enabled: true, intervalSeconds: 60 },
  );
  assert.deepEqual(
    resolveEffectiveRepeatNotification(
      createRule({ detailRuleEnabled: false, repeatNotification: { enabled: true, intervalSeconds: 60 } }),
    ),
    { enabled: false },
  );
  assert.deepEqual(
    resolveEffectiveRepeatNotification(
      createRule({
        detailConditions: { operator: "OR", children: [] },
        repeatNotification: { enabled: true, intervalSeconds: 60 },
      }),
    ),
    { enabled: false },
  );
  assert.deepEqual(
    resolveEffectiveRepeatNotification(
      createRule({ repeatNotification: { enabled: true, intervalSeconds: 59 } }),
    ),
    { enabled: false },
  );
  assert.deepEqual(
    resolveEffectiveRepeatNotification(
      createRule({ repeatNotification: { enabled: true, intervalSeconds: Number.NaN } }),
    ),
    { enabled: false },
  );
});

test("keeps raw attacker fields and duplicate key when display attack side is reversed", () => {
  const result = evaluateNotificationRule(
    createRule({ battleSide: "attack" }),
    createObservation({
      gvgCastleState: GVG_CASTLE_STATE.activeBattle,
      ...resolveDisplayGuildSides({
        gvgCastleState: GVG_CASTLE_STATE.activeBattle,
        ownerGuildId: "111111111001",
        ownerGuildName: "Owner A",
        attackerGuildId: "222222222001",
        attackerGuildName: "Attacker A",
      }),
    }),
  );

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(result.request.attackerGuildId, "222222222001");
  assert.equal(result.request.attackerGuildName, "Attacker A");
  assert.equal(result.request.attackGuildId, "111111111001");
  assert.equal(result.request.attackGuildName, "Owner A");
  assert.equal(result.request.defenseGuildId, "222222222001");
  assert.equal(result.request.defenseGuildName, "Attacker A");
  assert.equal(
    result.request.duplicateKey,
    "111111111001:guildBattle:1001:2026-06-17:rule-a:castle-1:222222222001",
  );
});

test("filters rules by battleSide derived from semantic guild sides", () => {
  assert.equal(
    evaluateNotificationRule(createRule({ battleSide: "defense" }), createObservation()).status,
    "matched",
  );
  assert.deepEqual(
    evaluateNotificationRule(
      createRule({ battleSide: "attack" }),
      createObservation({
        attackGuildId: "222222222001",
        defenseGuildId: "111111111001",
      }),
    ),
    {
      status: "skipped",
      reason: "battle_side_defense",
    },
  );
  assert.equal(
    evaluateNotificationRule(
      createRule({ battleSide: "attack", guildFilter: ["111111111001"] }),
      createObservation({
        attackGuildId: "111111111001",
        attackGuildName: "Own Guild",
        defenseGuildId: "222222222001",
      }),
    ).status,
    "matched",
  );
  assert.deepEqual(
    evaluateNotificationRule(
      createRule({ battleSide: "defense" }),
      createObservation({
        attackGuildId: "222222222001",
        defenseGuildId: "333333333001",
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

test("matches Grand Battle rules and keeps battle type in request payload", () => {
  const result = evaluateNotificationRule(
    createRule({
      battleType: "grandBattle",
      guildFilter: [],
      detailConditions: {
        operator: "OR",
        children: [
          {
            type: "group",
            operator: "AND",
            children: [
              {
                type: "condition",
                field: "defenseCount",
                operator: "<=",
                value: 30,
              },
              {
                type: "condition",
                field: "attackCount",
                operator: ">=",
                value: 1,
              },
            ],
          },
        ],
      },
    }),
    createObservation({
      battleType: "grandBattle",
      defenseCount: 30,
      attackCount: 1,
      worldId: "1037",
      blockId: 2,
    }),
  );

  assert.equal(result.status, "matched");
  if (result.status !== "matched") return;
  assert.equal(result.request.battleType, "grandBattle");
  assert.equal(result.request.source.blockId, 2);
  assert.equal(
    result.request.duplicateKey,
    "111111111001:grandBattle:1037:2026-06-17:rule-a:castle-1:222222222001",
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
  assert.equal(parseStartTimeMinutes("99:99"), null);
  assert.equal(parseStartTimeMinutes("12:99"), null);
  assert.equal(parseStartTimeMinutes("9:00"), null);
  assert.equal(createFallbackBaseName(12), "名称不明の拠点");
});

function createRule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "rule-a",
    schemaVersion: 2,
    battleType: "guildBattle",
    detailRuleEnabled: true,
    battleSide: "defense",
    name: "Rule A",
    enabled: true,
    sortOrder: 1,
    schedule: {
      startTime: "20:50",
      endTime: null,
    },
    guildFilter: [],
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
    repeatNotification: {
      enabled: false,
      intervalSeconds: 300,
    },
    ...overrides,
  };
}

function createRuleTick(overrides: Partial<NotificationRuleTick> = {}): NotificationRuleTick {
  return {
    guildId: "111111111001",
    battleType: "guildBattle",
    observedAt: new Date("2026-06-17T11:55:00.000Z"),
    worldId: "1001",
    runId: "run-a",
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
    gvgCastleState: GVG_CASTLE_STATE.activeDeclared,
    ownerGuildId: "111111111001",
    ownerGuildName: "Owner A",
    attackerGuildId: "222222222001",
    attackerGuildName: "Attacker A",
    attackGuildId: "222222222001",
    attackGuildName: "Attacker A",
    defenseGuildId: "111111111001",
    defenseGuildName: "Owner A",
    defenseCount: 2,
    attackCount: 5,
    observedAt: new Date("2026-06-17T11:55:00.000Z"),
    worldId: "1001",
    runId: "run-a",
    ...overrides,
  };
}
