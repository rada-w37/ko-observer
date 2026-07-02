import { createHash } from "node:crypto";
import { GVG_CASTLE_STATE } from "../../mentemori/types.js";
import { UNKNOWN_CASTLE_NAME } from "./castleName.js";

export type NotificationBattleType = "guildBattle" | "grandBattle";
export type NotificationBattleSide = "defense" | "attack";
export type DerivedBattleSide = NotificationBattleSide | "unrelated";

export type NotificationMention =
  | {
      type: "none" | "here" | "everyone";
      customText?: string;
    }
  | {
      type: "custom";
      customText?: string;
    };

export type NotificationDetailCondition = {
  type: "condition";
  field: "defenseCount" | "attackCount";
  operator: "<=" | ">=";
  value: number;
};

export type NotificationDetailConditionGroup = {
  type: "group";
  operator: "AND" | "OR";
  children: NotificationDetailCondition[];
};

export type NotificationDetailConditionRoot = {
  operator: "OR";
  children: Array<NotificationDetailCondition | NotificationDetailConditionGroup>;
};

export type NotificationRule = {
  id: string;
  schemaVersion: 2;
  battleType: NotificationBattleType;
  detailRuleEnabled: boolean;
  battleSide: NotificationBattleSide;
  name: string;
  enabled: boolean;
  sortOrder: number;
  schedule: {
    startTime: string;
    endTime: string | null;
  };
  guildFilter: string[];
  detailConditions: NotificationDetailConditionRoot;
  message: {
    usernameTemplate: string;
    mention: NotificationMention;
    titleTemplate: string;
    bodyTemplate: string;
  };
  temporarySuspension?: {
    expiresAt: string;
  };
};

export type NotificationObservation = {
  guildId: string;
  battleType: NotificationBattleType;
  castleId: number;
  castleName: string;
  gvgCastleState: number;
  ownerGuildId: string | null;
  ownerGuildName: string | null;
  attackerGuildId: string | null;
  attackerGuildName: string | null;
  attackGuildId: string | null;
  attackGuildName: string | null;
  defenseGuildId: string | null;
  defenseGuildName: string | null;
  defenseCount: number;
  attackCount: number;
  observedAt: Date;
  worldId: string;
  blockId?: number;
  runId: string;
};

export type NotificationRuleTick = {
  guildId: string;
  battleType: NotificationBattleType;
  observedAt: Date;
  worldId: string;
  blockId?: number;
  runId: string;
};

export type NotificationRequest = {
  guildId: string;
  battleType: NotificationBattleType;
  ruleId: string;
  ruleName: string;
  detailRuleEnabled: boolean;
  duplicateKey: string;
  activeTimeWindow: string;
  baseId?: string;
  baseName?: string;
  castleName?: string;
  gvgCastleState?: number;
  ownerGuildId?: string | null;
  ownerGuildName?: string;
  attackerGuildId?: string;
  attackerGuildName?: string;
  attackGuildId?: string | null;
  attackGuildName?: string;
  defenseGuildId?: string | null;
  defenseGuildName?: string;
  defenseCount?: number;
  attackCount?: number;
  message: {
    username: string;
    mentionText: string;
    title: string;
    body: string;
  };
  source: {
    observedAt: Date;
    battleDate: string;
    worldId: string;
    blockId?: number;
    runId: string;
  };
  status: "pending";
  createdAt: Date;
};

export type NotificationEvaluationResult =
  | {
      status: "matched";
      requestId: string;
      request: NotificationRequest;
    }
  | {
      status: "skipped";
      reason: string;
    };

const TEMPLATE_VARIABLES = {
  baseName: "{拠点名}",
  attackerGuild: "{侵攻ギルド}",
  defenseGuild: "{防衛ギルド}",
  defenseCount: "{防衛数}",
  attackCount: "{侵攻数}",
  notificationTime: "{通知時刻}",
  ruleName: "{通知ルール名}",
} as const;
const DETAIL_RULE_OFF_UNAVAILABLE_VARIABLES = [
  TEMPLATE_VARIABLES.baseName,
  TEMPLATE_VARIABLES.attackerGuild,
  TEMPLATE_VARIABLES.defenseGuild,
  TEMPLATE_VARIABLES.defenseCount,
  TEMPLATE_VARIABLES.attackCount,
] as const;
const MESSAGE_TITLE_MAX_LENGTH = 120;
const TRUNCATED_TITLE_SUFFIX = "…";

export function evaluateNotificationRule(
  rule: NotificationRule,
  observation: NotificationObservation,
): NotificationEvaluationResult {
  if (!rule.detailRuleEnabled) {
    return { status: "skipped", reason: "detail_rule_disabled" };
  }

  if (!rule.enabled) {
    return { status: "skipped", reason: "disabled" };
  }

  if (rule.battleType !== observation.battleType) {
    return { status: "skipped", reason: "battle_type_mismatch" };
  }

  const derivedBattleSide = deriveBattleSideFromObservation({
    ownGuildId: observation.guildId,
    attackGuildId: observation.attackGuildId,
    defenseGuildId: observation.defenseGuildId,
  });
  if (derivedBattleSide !== rule.battleSide) {
    return { status: "skipped", reason: `battle_side_${derivedBattleSide}` };
  }

  if (isTemporarilySuspended(rule, observation)) {
    return { status: "skipped", reason: "temporary_suspended" };
  }

  if (!isTargetGuildMatched(rule, observation)) {
    return { status: "skipped", reason: "target_guild_not_matched" };
  }

  const activeTimeResult = evaluateActiveTime(rule, observation.observedAt);
  if (activeTimeResult.status === "skipped") {
    return activeTimeResult;
  }

  if (!evaluateDetailConditionRoot(rule.detailConditions, observation)) {
    return { status: "skipped", reason: "detail_conditions_not_matched" };
  }

  const request = createNotificationRequest(rule, observation);
  return {
    status: "matched",
    requestId: createNotificationRequestId(request.duplicateKey),
    request,
  };
}

export function evaluateRuleLevelNotification(
  rule: NotificationRule,
  tick: NotificationRuleTick,
): NotificationEvaluationResult {
  if (rule.detailRuleEnabled) {
    return { status: "skipped", reason: "detail_rule_enabled" };
  }

  if (!rule.enabled) {
    return { status: "skipped", reason: "disabled" };
  }

  if (rule.battleType !== tick.battleType) {
    return { status: "skipped", reason: "battle_type_mismatch" };
  }

  if (isTemporarilySuspended(rule, tick)) {
    return { status: "skipped", reason: "temporary_suspended" };
  }

  const activeTimeResult = evaluateActiveTime(rule, tick.observedAt);
  if (activeTimeResult.status === "skipped") {
    return activeTimeResult;
  }

  if (hasDetailRuleOnlyTemplateVariable(rule)) {
    return { status: "skipped", reason: "detail_rule_off_template_variables" };
  }

  const request = createRuleLevelNotificationRequest(rule, tick, activeTimeResult.activeTimeWindow);
  return {
    status: "matched",
    requestId: createNotificationRequestId(request.duplicateKey),
    request,
  };
}

export function createNotificationRequest(
  rule: NotificationRule,
  observation: NotificationObservation,
): NotificationRequest {
  const baseId = `castle-${observation.castleId}`;
  const battleDate = getJstDateString(observation.observedAt);
  const notificationTime = getJstTimeString(observation.observedAt);
  const activeTimeWindow = createActiveTimeWindow(rule);
  const attackerGuildName = resolveAttackerGuildName(observation);
  const ownerGuildName = resolveGuildName(observation.ownerGuildId, observation.ownerGuildName);
  const attackGuildName = resolveGuildName(observation.attackGuildId, observation.attackGuildName);
  const defenseGuildName = resolveGuildName(
    observation.defenseGuildId,
    observation.defenseGuildName,
  );
  const duplicateKey = createDuplicateKey({
    guildId: observation.guildId,
    battleType: observation.battleType,
    ruleId: rule.id,
    baseId,
    attackerKey: resolveAttackerKey(observation),
    battleDate,
    worldId: observation.worldId,
  });

  return {
    guildId: observation.guildId,
    battleType: observation.battleType,
    ruleId: rule.id,
    ruleName: rule.name,
    detailRuleEnabled: true,
    duplicateKey,
    activeTimeWindow,
    baseId,
    baseName: observation.castleName,
    castleName: observation.castleName,
    gvgCastleState: observation.gvgCastleState,
    ownerGuildId: observation.ownerGuildId,
    ownerGuildName,
    ...(observation.attackerGuildId ? { attackerGuildId: observation.attackerGuildId } : {}),
    attackerGuildName,
    attackGuildId: observation.attackGuildId,
    attackGuildName,
    defenseGuildId: observation.defenseGuildId,
    defenseGuildName,
    defenseCount: observation.defenseCount,
    attackCount: observation.attackCount,
    message: {
      username: renderTemplate(rule.message.usernameTemplate, rule, observation, {
        attackGuildName,
        defenseGuildName,
        notificationTime,
      }),
      mentionText: renderMention(rule.message.mention),
      title: normalizeMessageTitle(
        renderTemplate(rule.message.titleTemplate, rule, observation, {
          attackGuildName,
          defenseGuildName,
          notificationTime,
        }),
      ),
      body: renderTemplate(rule.message.bodyTemplate, rule, observation, {
        attackGuildName,
        defenseGuildName,
        notificationTime,
      }),
    },
    source: {
      observedAt: observation.observedAt,
      battleDate,
      worldId: observation.worldId,
      ...(observation.blockId === undefined ? {} : { blockId: observation.blockId }),
      runId: observation.runId,
    },
    status: "pending",
    createdAt: observation.observedAt,
  };
}

export function createNotificationRequestId(duplicateKey: string): string {
  return createHash("sha256").update(duplicateKey).digest("hex");
}

export function createFallbackBaseName(_castleId: number): string {
  return UNKNOWN_CASTLE_NAME;
}

export function resolveDisplayGuildSides(input: {
  gvgCastleState: number;
  ownerGuildId: string | null;
  ownerGuildName: string | null;
  attackerGuildId: string | null;
  attackerGuildName: string | null;
}): {
  attackGuildId: string | null;
  attackGuildName: string | null;
  defenseGuildId: string | null;
  defenseGuildName: string | null;
} {
  const ownerSide = {
    guildId: input.ownerGuildId,
    guildName: resolveNullableGuildName(input.ownerGuildId, input.ownerGuildName),
  };
  const attackerSide = {
    guildId: input.attackerGuildId,
    guildName: resolveNullableGuildName(input.attackerGuildId, input.attackerGuildName),
  };

  switch (input.gvgCastleState) {
    case GVG_CASTLE_STATE.activeDeclared:
      return createDisplayGuildSides(attackerSide, ownerSide);
    case GVG_CASTLE_STATE.activeBattle:
    case GVG_CASTLE_STATE.activeCounterattack:
      return createDisplayGuildSides(ownerSide, attackerSide);
    case GVG_CASTLE_STATE.activeCounterattackSuccessful:
    case GVG_CASTLE_STATE.inactive:
      return createDisplayGuildSides(null, ownerSide);
    default:
      return createDisplayGuildSides(null, null);
  }
}

export function deriveBattleSideFromCastleStatus(input: {
  ownGuildId: string;
  ownerGuildId: string | null;
  attackerGuildId: string | null;
  attackCount: number;
}): DerivedBattleSide {
  if (input.ownerGuildId === input.ownGuildId && input.attackCount > 0) {
    return "defense";
  }

  if (
    input.attackerGuildId === input.ownGuildId &&
    input.ownerGuildId !== input.ownGuildId &&
    input.attackCount > 0
  ) {
    return "attack";
  }

  return "unrelated";
}

export function deriveBattleSideFromObservation(input: {
  ownGuildId: string;
  attackGuildId: string | null;
  defenseGuildId: string | null;
}): DerivedBattleSide {
  if (input.defenseGuildId === input.ownGuildId) {
    return "defense";
  }

  if (input.attackGuildId === input.ownGuildId) {
    return "attack";
  }

  return "unrelated";
}

export function compareNotificationRulePriority(
  firstRule: NotificationRule,
  secondRule: NotificationRule,
): number {
  const firstStartTime = parseStartTimeMinutes(firstRule.schedule.startTime) ?? -1;
  const secondStartTime = parseStartTimeMinutes(secondRule.schedule.startTime) ?? -1;
  if (firstStartTime !== secondStartTime) {
    return secondStartTime - firstStartTime;
  }
  if (firstRule.sortOrder !== secondRule.sortOrder) {
    return firstRule.sortOrder - secondRule.sortOrder;
  }
  return firstRule.id.localeCompare(secondRule.id);
}

export function parseStartTimeMinutes(startTime: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startTime);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function createDuplicateKey(input: {
  guildId: string;
  battleType: NotificationBattleType;
  worldId: string;
  battleDate: string;
  ruleId: string;
  baseId: string;
  attackerKey: string;
}): string {
  return [
    input.guildId,
    input.battleType,
    input.worldId,
    input.battleDate,
    input.ruleId,
    input.baseId,
    input.attackerKey,
  ].join(":");
}

function createRuleLevelDuplicateKey(input: {
  guildId: string;
  battleType: NotificationBattleType;
  worldId: string;
  battleDate: string;
  ruleId: string;
  activeTimeWindow: string;
}): string {
  return [
    input.guildId,
    input.battleType,
    input.worldId,
    input.battleDate,
    input.ruleId,
    "time",
    input.activeTimeWindow,
  ].join(":");
}

function renderMention(mention: NotificationMention): string {
  if (mention.type === "here") {
    return "@here";
  }
  if (mention.type === "everyone") {
    return "@everyone";
  }
  if (mention.type === "custom") {
    return mention.customText?.trim() ?? "";
  }
  return "";
}

function renderTemplate(
  template: string,
  rule: NotificationRule,
  observation: NotificationObservation,
  values: {
    attackGuildName: string;
    defenseGuildName: string;
    notificationTime: string;
  },
): string {
  return template
    .replaceAll(TEMPLATE_VARIABLES.baseName, observation.castleName)
    .replaceAll(TEMPLATE_VARIABLES.attackerGuild, values.attackGuildName)
    .replaceAll(TEMPLATE_VARIABLES.defenseGuild, values.defenseGuildName)
    .replaceAll(TEMPLATE_VARIABLES.defenseCount, observation.defenseCount.toString())
    .replaceAll(TEMPLATE_VARIABLES.attackCount, observation.attackCount.toString())
    .replaceAll(TEMPLATE_VARIABLES.notificationTime, values.notificationTime)
    .replaceAll(TEMPLATE_VARIABLES.ruleName, rule.name);
}

function renderRuleLevelTemplate(
  template: string,
  rule: NotificationRule,
  notificationTime: string,
): string {
  return template
    .replaceAll(TEMPLATE_VARIABLES.notificationTime, notificationTime)
    .replaceAll(TEMPLATE_VARIABLES.ruleName, rule.name);
}

function normalizeMessageTitle(title: string): string {
  const titleCharacters = Array.from(title);
  if (titleCharacters.length <= MESSAGE_TITLE_MAX_LENGTH) {
    return title;
  }

  const suffixLength = Array.from(TRUNCATED_TITLE_SUFFIX).length;
  return `${titleCharacters.slice(0, MESSAGE_TITLE_MAX_LENGTH - suffixLength).join("")}${TRUNCATED_TITLE_SUFFIX}`;
}

function isTemporarilySuspended(
  rule: NotificationRule,
  observation: Pick<NotificationObservation, "observedAt"> | Pick<NotificationRuleTick, "observedAt">,
): boolean {
  if (rule.temporarySuspension === undefined) {
    return false;
  }

  const expiresAtMilliseconds = Date.parse(rule.temporarySuspension.expiresAt);
  return (
    Number.isFinite(expiresAtMilliseconds) &&
    expiresAtMilliseconds > observation.observedAt.getTime()
  );
}

function isTargetGuildMatched(
  rule: NotificationRule,
  observation: NotificationObservation,
): boolean {
  if (rule.guildFilter.length === 0) {
    return true;
  }

  return (
    (observation.attackGuildId !== null && rule.guildFilter.includes(observation.attackGuildId)) ||
    (observation.defenseGuildId !== null && rule.guildFilter.includes(observation.defenseGuildId))
  );
}

function evaluateDetailConditionRoot(
  root: NotificationDetailConditionRoot,
  observation: NotificationObservation,
): boolean {
  if (!hasDetailCondition(root)) {
    return true;
  }

  return root.children.some((node) => evaluateDetailConditionNode(node, observation));
}

function evaluateDetailConditionNode(
  node: NotificationDetailCondition | NotificationDetailConditionGroup,
  observation: NotificationObservation,
): boolean {
  if (node.type === "condition") {
    return evaluateDetailCondition(node, observation);
  }

  if (node.children.length === 0) {
    return false;
  }

  if (node.operator === "AND") {
    return node.children.every((condition) => evaluateDetailCondition(condition, observation));
  }

  return node.children.some((condition) => evaluateDetailCondition(condition, observation));
}

function evaluateDetailCondition(
  condition: NotificationDetailCondition,
  observation: NotificationObservation,
): boolean {
  const observedValue =
    condition.field === "defenseCount" ? observation.defenseCount : observation.attackCount;
  return condition.operator === "<="
    ? observedValue <= condition.value
    : observedValue >= condition.value;
}

function hasDetailCondition(root: NotificationDetailConditionRoot): boolean {
  return root.children.some((node) => {
    if (node.type === "condition") {
      return true;
    }
    return node.children.length > 0;
  });
}

function evaluateActiveTime(
  rule: NotificationRule,
  observedAt: Date,
): { status: "matched"; activeTimeWindow: string } | { status: "skipped"; reason: string } {
  const startTimeMinutes = parseStartTimeMinutes(rule.schedule.startTime);
  if (startTimeMinutes === null) {
    return { status: "skipped", reason: "invalid_start_time" };
  }

  const endTimeMinutes =
    rule.schedule.endTime === null ? null : parseStartTimeMinutes(rule.schedule.endTime);
  if (rule.schedule.endTime !== null && endTimeMinutes === null) {
    return { status: "skipped", reason: "invalid_end_time" };
  }

  const observedMinutes = getJstTimeMinutes(observedAt);
  if (observedMinutes < startTimeMinutes) {
    return { status: "skipped", reason: "before_start_time" };
  }

  if (endTimeMinutes !== null && observedMinutes > endTimeMinutes) {
    return { status: "skipped", reason: "after_end_time" };
  }

  return {
    status: "matched",
    activeTimeWindow: createActiveTimeWindow(rule),
  };
}

function createActiveTimeWindow(rule: NotificationRule): string {
  return `${rule.schedule.startTime}-${rule.schedule.endTime ?? "open"}`;
}

function hasDetailRuleOnlyTemplateVariable(rule: NotificationRule): boolean {
  return [
    rule.message.usernameTemplate,
    rule.message.titleTemplate,
    rule.message.bodyTemplate,
  ].some((template) =>
    DETAIL_RULE_OFF_UNAVAILABLE_VARIABLES.some((variable) => template.includes(variable)),
  );
}

function resolveAttackerKey(observation: NotificationObservation): string {
  return observation.attackerGuildId ?? "no-attacker";
}

function resolveAttackerGuildName(observation: NotificationObservation): string {
  return resolveGuildName(observation.attackerGuildId, observation.attackerGuildName);
}

function resolveGuildName(guildId: string | null, guildName: string | null): string {
  return resolveNullableGuildName(guildId, guildName) ?? "不明";
}

function resolveNullableGuildName(guildId: string | null, guildName: string | null): string | null {
  if (guildName) {
    return guildName;
  }
  if (guildId) {
    return `ギルド${guildId}`;
  }
  return null;
}

function createDisplayGuildSides(
  attackSide: { guildId: string | null; guildName: string | null } | null,
  defenseSide: { guildId: string | null; guildName: string | null } | null,
): {
  attackGuildId: string | null;
  attackGuildName: string | null;
  defenseGuildId: string | null;
  defenseGuildName: string | null;
} {
  return {
    attackGuildId: attackSide?.guildId ?? null,
    attackGuildName: attackSide?.guildName ?? null,
    defenseGuildId: defenseSide?.guildId ?? null,
    defenseGuildName: defenseSide?.guildName ?? null,
  };
}

export function createRuleLevelNotificationRequest(
  rule: NotificationRule,
  tick: NotificationRuleTick,
  activeTimeWindow: string = createActiveTimeWindow(rule),
): NotificationRequest {
  const battleDate = getJstDateString(tick.observedAt);
  const notificationTime = getJstTimeString(tick.observedAt);
  const duplicateKey = createRuleLevelDuplicateKey({
    guildId: tick.guildId,
    battleType: tick.battleType,
    ruleId: rule.id,
    battleDate,
    worldId: tick.worldId,
    activeTimeWindow,
  });

  return {
    guildId: tick.guildId,
    battleType: tick.battleType,
    ruleId: rule.id,
    ruleName: rule.name,
    detailRuleEnabled: false,
    duplicateKey,
    activeTimeWindow,
    message: {
      username: renderRuleLevelTemplate(rule.message.usernameTemplate, rule, notificationTime),
      mentionText: renderMention(rule.message.mention),
      title: normalizeMessageTitle(
        renderRuleLevelTemplate(rule.message.titleTemplate, rule, notificationTime),
      ),
      body: renderRuleLevelTemplate(rule.message.bodyTemplate, rule, notificationTime),
    },
    source: {
      observedAt: tick.observedAt,
      battleDate,
      worldId: tick.worldId,
      ...(tick.blockId === undefined ? {} : { blockId: tick.blockId }),
      runId: tick.runId,
    },
    status: "pending",
    createdAt: tick.observedAt,
  };
}

function getJstDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function getJstTimeString(date: Date): string {
  const parts = getJstTimeParts(date);
  return `${parts.hour.toString().padStart(2, "0")}:${parts.minute
    .toString()
    .padStart(2, "0")}`;
}

function getJstTimeMinutes(date: Date): number {
  const parts = getJstTimeParts(date);
  return parts.hour * 60 + parts.minute;
}

function getJstTimeParts(date: Date): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const partByType = new Map(parts.map((part) => [part.type, part.value]));

  return {
    hour: Number(partByType.get("hour")),
    minute: Number(partByType.get("minute")),
  };
}
