import { createHash } from "node:crypto";

export type NotificationBattleType = "guildBattle" | "grandBattle";

export type NotificationMention =
  | {
      type: "none" | "here" | "everyone";
      customText?: string;
    }
  | {
      type: "custom";
      customText?: string;
    };

export type NotificationRule = {
  id: string;
  battleType: NotificationBattleType;
  name: string;
  enabled: boolean;
  conditions: {
    startTime: string;
    defenseCountMax: number | null;
    attackCountMin: number | null;
  };
  message: {
    usernameTemplate: string;
    mention: NotificationMention;
    titleTemplate: string;
    bodyTemplate: string;
  };
};

export type NotificationObservation = {
  guildId: string;
  battleType: NotificationBattleType;
  castleId: number;
  baseName: string;
  attackerGuildId: string | null;
  attackerGuildName: string | null;
  defenseCount: number;
  attackCount: number;
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
  duplicateKey: string;
  baseId: string;
  baseName: string;
  attackerGuildId?: string;
  attackerGuildName: string;
  defenseCount: number;
  attackCount: number;
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
  defenseCount: "{防御数}",
  attackCount: "{侵攻数}",
  notificationTime: "{通知時刻}",
  ruleName: "{通知ルール名}",
} as const;

export function evaluateNotificationRule(
  rule: NotificationRule,
  observation: NotificationObservation,
): NotificationEvaluationResult {
  if (!rule.enabled) {
    return { status: "skipped", reason: "disabled" };
  }

  if (rule.battleType !== observation.battleType) {
    return { status: "skipped", reason: "battle_type_mismatch" };
  }

  const startTimeMinutes = parseStartTimeMinutes(rule.conditions.startTime);
  if (startTimeMinutes === null) {
    return { status: "skipped", reason: "invalid_start_time" };
  }

  if (getJstTimeMinutes(observation.observedAt) < startTimeMinutes) {
    return { status: "skipped", reason: "before_start_time" };
  }

  if (
    rule.conditions.defenseCountMax !== null &&
    observation.defenseCount > rule.conditions.defenseCountMax
  ) {
    return { status: "skipped", reason: "defense_count_not_matched" };
  }

  if (
    rule.conditions.attackCountMin !== null &&
    observation.attackCount < rule.conditions.attackCountMin
  ) {
    return { status: "skipped", reason: "attack_count_not_matched" };
  }

  const request = createNotificationRequest(rule, observation);
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
  const attackerGuildName = resolveAttackerGuildName(observation);
  const duplicateKey = createDuplicateKey({
    guildId: observation.guildId,
    battleType: observation.battleType,
    ruleId: rule.id,
    baseId,
    attackerKey: resolveAttackerKey(observation),
    battleDate,
    startTime: rule.conditions.startTime,
  });

  return {
    guildId: observation.guildId,
    battleType: observation.battleType,
    ruleId: rule.id,
    ruleName: rule.name,
    duplicateKey,
    baseId,
    baseName: observation.baseName,
    ...(observation.attackerGuildId ? { attackerGuildId: observation.attackerGuildId } : {}),
    attackerGuildName,
    defenseCount: observation.defenseCount,
    attackCount: observation.attackCount,
    message: {
      username: renderTemplate(rule.message.usernameTemplate, rule, observation, {
        attackerGuildName,
        notificationTime,
      }),
      mentionText: renderMention(rule.message.mention),
      title: renderTemplate(rule.message.titleTemplate, rule, observation, {
        attackerGuildName,
        notificationTime,
      }),
      body: renderTemplate(rule.message.bodyTemplate, rule, observation, {
        attackerGuildName,
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

export function createFallbackBaseName(castleId: number): string {
  return `拠点${castleId}`;
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
  ruleId: string;
  baseId: string;
  attackerKey: string;
  battleDate: string;
  startTime: string;
}): string {
  return [
    input.guildId,
    input.battleType,
    input.ruleId,
    input.baseId,
    input.attackerKey,
    input.battleDate,
    input.startTime,
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
    attackerGuildName: string;
    notificationTime: string;
  },
): string {
  return template
    .replaceAll(TEMPLATE_VARIABLES.baseName, observation.baseName)
    .replaceAll(TEMPLATE_VARIABLES.attackerGuild, values.attackerGuildName)
    .replaceAll(TEMPLATE_VARIABLES.defenseCount, observation.defenseCount.toString())
    .replaceAll(TEMPLATE_VARIABLES.attackCount, observation.attackCount.toString())
    .replaceAll(TEMPLATE_VARIABLES.notificationTime, values.notificationTime)
    .replaceAll(TEMPLATE_VARIABLES.ruleName, rule.name);
}

function resolveAttackerKey(observation: NotificationObservation): string {
  return observation.attackerGuildId ?? observation.attackerGuildName ?? "unknown";
}

function resolveAttackerGuildName(observation: NotificationObservation): string {
  if (observation.attackerGuildName) {
    return observation.attackerGuildName;
  }
  if (observation.attackerGuildId) {
    return `ギルド${observation.attackerGuildId}`;
  }
  return "不明";
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
