import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  parseStartTimeMinutes,
  type NotificationMention,
  type NotificationRequest,
  type NotificationRule,
} from "../notifications/domain/notificationDomain.js";

const GUILD_SHARES_COLLECTION = "guildShares";
const NOTIFICATION_RULES_COLLECTION = "notificationRules";
const NOTIFICATION_REQUESTS_COLLECTION = "notificationRequests";

export type LoadNotificationRulesResult = {
  rules: NotificationRule[];
  skippedInvalidCount: number;
};

export type CreateNotificationRequestResult =
  | {
      status: "created";
    }
  | {
      status: "duplicate";
    };

type NotificationRuleData = {
  battleType?: unknown;
  name?: unknown;
  enabled?: unknown;
  conditions?: unknown;
  message?: unknown;
};

export async function loadNotificationRules(
  firestore: Firestore,
  guildId: string,
): Promise<LoadNotificationRulesResult> {
  const snapshot = await firestore
    .collection(GUILD_SHARES_COLLECTION)
    .doc(guildId)
    .collection(NOTIFICATION_RULES_COLLECTION)
    .get();
  const rules: NotificationRule[] = [];
  let skippedInvalidCount = 0;

  for (const documentSnapshot of snapshot.docs) {
    const rule = normalizeNotificationRule(documentSnapshot.id, documentSnapshot.data());
    if (!rule) {
      skippedInvalidCount += 1;
      continue;
    }
    rules.push(rule);
  }

  return {
    rules,
    skippedInvalidCount,
  };
}

export async function createNotificationRequest(
  firestore: Firestore,
  requestId: string,
  request: NotificationRequest,
): Promise<CreateNotificationRequestResult> {
  try {
    await firestore
      .collection(NOTIFICATION_REQUESTS_COLLECTION)
      .doc(requestId)
      .create(toFirestoreNotificationRequest(request));
    return { status: "created" };
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return { status: "duplicate" };
    }
    throw error;
  }
}

function normalizeNotificationRule(ruleId: string, rawData: unknown): NotificationRule | null {
  if (!isRecord(rawData)) {
    return null;
  }

  const data = rawData as NotificationRuleData;
  if (
    data.battleType !== "guildBattle" &&
    data.battleType !== "grandBattle"
  ) {
    return null;
  }
  if (typeof data.name !== "string" || data.name.trim().length === 0) {
    return null;
  }
  if (typeof data.enabled !== "boolean") {
    return null;
  }
  if (!isRecord(data.conditions) || !isRecord(data.message)) {
    return null;
  }

  const startTime = data.conditions.startTime;
  const defenseCountMax = data.conditions.defenseCountMax;
  const attackCountMin = data.conditions.attackCountMin;
  const usernameTemplate = data.message.usernameTemplate;
  const mention = normalizeMention(data.message.mention);
  const titleTemplate = data.message.titleTemplate;
  const bodyTemplate = data.message.bodyTemplate;

  if (typeof startTime !== "string" || parseStartTimeMinutes(startTime) === null) {
    return null;
  }
  if (!isOptionalNonNegativeInteger(defenseCountMax)) {
    return null;
  }
  if (!isOptionalNonNegativeInteger(attackCountMin)) {
    return null;
  }
  if (
    typeof usernameTemplate !== "string" ||
    typeof titleTemplate !== "string" ||
    typeof bodyTemplate !== "string" ||
    !mention
  ) {
    return null;
  }

  return {
    id: ruleId,
    battleType: data.battleType,
    name: data.name,
    enabled: data.enabled,
    conditions: {
      startTime,
      defenseCountMax,
      attackCountMin,
    },
    message: {
      usernameTemplate,
      mention,
      titleTemplate,
      bodyTemplate,
    },
  };
}

function normalizeMention(value: unknown): NotificationMention | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.type === "none" ||
    value.type === "here" ||
    value.type === "everyone"
  ) {
    return {
      type: value.type,
    };
  }

  if (value.type === "custom") {
    return {
      type: "custom",
      ...(typeof value.customText === "string" ? { customText: value.customText } : {}),
    };
  }

  return null;
}

function isOptionalNonNegativeInteger(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function toFirestoreNotificationRequest(request: NotificationRequest): Record<string, unknown> {
  return {
    guildId: request.guildId,
    battleType: request.battleType,
    ruleId: request.ruleId,
    ruleName: request.ruleName,
    duplicateKey: request.duplicateKey,
    baseId: request.baseId,
    baseName: request.baseName,
    ...(request.attackerGuildId ? { attackerGuildId: request.attackerGuildId } : {}),
    attackerGuildName: request.attackerGuildName,
    defenseCount: request.defenseCount,
    attackCount: request.attackCount,
    message: request.message,
    source: {
      ...request.source,
      observedAt: Timestamp.fromDate(request.source.observedAt),
    },
    status: request.status,
    createdAt: Timestamp.fromDate(request.createdAt),
  };
}

function isAlreadyExistsError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  return error.code === 6 || error.code === "already-exists";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
