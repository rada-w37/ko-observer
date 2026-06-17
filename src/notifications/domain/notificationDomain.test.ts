import assert from "node:assert/strict";
import test from "node:test";
import {
  createFallbackBaseName,
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

test("compares start time by JST minutes", () => {
  const rule = createRule({
    conditions: {
      startTime: "20:55",
      defenseCountMax: null,
      attackCountMin: null,
    },
  });

  assert.deepEqual(
    evaluateNotificationRule(rule, createObservation({ observedAt: new Date("2026-06-17T11:54:00.000Z") })),
    {
      status: "skipped",
      reason: "before_start_time",
    },
  );
  assert.equal(
    evaluateNotificationRule(rule, createObservation({ observedAt: new Date("2026-06-17T11:55:00.000Z") })).status,
    "matched",
  );
});

test("evaluates defense and attack count conditions", () => {
  const rule = createRule({
    conditions: {
      startTime: "20:50",
      defenseCountMax: 3,
      attackCountMin: 2,
    },
  });

  assert.deepEqual(evaluateNotificationRule(rule, createObservation({ defenseCount: 4 })), {
    status: "skipped",
    reason: "defense_count_not_matched",
  });
  assert.deepEqual(evaluateNotificationRule(rule, createObservation({ attackCount: 1 })), {
    status: "skipped",
    reason: "attack_count_not_matched",
  });
  assert.equal(
    evaluateNotificationRule(rule, createObservation({ defenseCount: 3, attackCount: 2 })).status,
    "matched",
  );
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
  assert.equal(result.request.message.title, "拠点1 Attacker A");
  assert.equal(result.request.message.body, "2/5 20:55");
});

test("creates stable request id and attacker key fallbacks", () => {
  const rule = createRule();
  const withId = evaluateNotificationRule(rule, createObservation());
  const withIdAgain = evaluateNotificationRule(rule, createObservation());
  const withName = evaluateNotificationRule(
    rule,
    createObservation({ attackerGuildId: null, attackerGuildName: "Attacker A" }),
  );
  const unknown = evaluateNotificationRule(
    rule,
    createObservation({ attackerGuildId: null, attackerGuildName: null }),
  );

  assert.equal(withId.status, "matched");
  assert.equal(withIdAgain.status, "matched");
  assert.equal(withName.status, "matched");
  assert.equal(unknown.status, "matched");
  if (
    withId.status !== "matched" ||
    withIdAgain.status !== "matched" ||
    withName.status !== "matched" ||
    unknown.status !== "matched"
  ) {
    return;
  }

  assert.equal(withId.requestId, withIdAgain.requestId);
  assert.match(withId.request.duplicateKey, /:222222222001:/);
  assert.match(withName.request.duplicateKey, /:Attacker A:/);
  assert.match(unknown.request.duplicateKey, /:unknown:/);
  assert.equal(unknown.request.attackerGuildName, "不明");
});

test("parses start time and creates fallback base name", () => {
  assert.equal(parseStartTimeMinutes("00:00"), 0);
  assert.equal(parseStartTimeMinutes("23:59"), 1439);
  assert.equal(parseStartTimeMinutes("24:00"), null);
  assert.equal(parseStartTimeMinutes("9:00"), null);
  assert.equal(createFallbackBaseName(12), "拠点12");
});

function createRule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "rule-a",
    battleType: "guildBattle",
    name: "Rule A",
    enabled: true,
    conditions: {
      startTime: "20:50",
      defenseCountMax: null,
      attackCountMin: null,
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
    baseName: "拠点1",
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
