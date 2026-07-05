import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  createNotificationRequestId,
  createRepeatNotificationRequestId,
  parseStartTimeMinutes,
  type NotificationDetailCondition,
  type NotificationDetailConditionGroup,
  type NotificationDetailConditionRoot,
  type NotificationMention,
  type NotificationRequest,
  type NotificationBattleSide,
  type NotificationRule,
} from "../notifications/domain/notificationDomain.js";

const GUILD_SHARES_COLLECTION = "guildShares";
const NOTIFICATION_RULES_COLLECTION = "notificationRules";
const NOTIFICATION_REQUESTS_COLLECTION = "notificationRequests";
const NOTIFICATION_REPEAT_STATES_COLLECTION = "notificationRepeatStates";
const TITLE_TEMPLATE_MAX_LENGTH = 120;
const DEFAULT_REPEAT_INTERVAL_SECONDS = 300;
const MIN_REPEAT_INTERVAL_SECONDS = 30;
const MAX_REPEAT_INTERVAL_SECONDS = 2700;
const REPEAT_STATE_TTL_DAYS = 7;
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type LoadNotificationRulesResult = {
  rules: NotificationRule[];
  skippedUnsupportedVersionCount: number;
  skippedUnsupportedGrandBattleCount: number;
  skippedInvalidSchemaCount: number;
};

export type CreateNotificationRequestResult =
  | {
      status: "created";
    }
  | {
      status: "duplicate";
    };

type NotificationRuleData = {
  schemaVersion?: unknown;
  battleType?: unknown;
  detailRuleEnabled?: unknown;
  battleSide?: unknown;
  name?: unknown;
  enabled?: unknown;
  sortOrder?: unknown;
  schedule?: unknown;
  guildFilter?: unknown;
  attackerGuildIds?: unknown;
  targetGuildIds?: unknown;
  detailConditions?: unknown;
  message?: unknown;
  repeatNotification?: unknown;
  temporarySuspension?: unknown;
};

type NormalizeNotificationRuleResult =
  | {
      status: "accepted";
      rule: NotificationRule;
    }
  | {
      status: "skipped";
      reason: "unsupportedVersion" | "invalidSchema";
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
  let skippedUnsupportedVersionCount = 0;
  let skippedUnsupportedGrandBattleCount = 0;
  let skippedInvalidSchemaCount = 0;

  for (const documentSnapshot of snapshot.docs) {
    const result = normalizeNotificationRule(documentSnapshot.id, documentSnapshot.data());
    if (result.status === "skipped") {
      if (result.reason === "unsupportedVersion") {
        skippedUnsupportedVersionCount += 1;
      } else {
        skippedInvalidSchemaCount += 1;
      }
      continue;
    }
    rules.push(result.rule);
  }

  return {
    rules,
    skippedUnsupportedVersionCount,
    skippedUnsupportedGrandBattleCount,
    skippedInvalidSchemaCount,
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

export async function createRepeatNotificationRequest(
  firestore: Firestore,
  request: NotificationRequest,
  intervalSeconds: number,
): Promise<CreateNotificationRequestResult | { status: "skipped" }> {
  const rawBaseNotificationKey = request.duplicateKey;
  const baseNotificationKey = createNotificationRequestId(rawBaseNotificationKey);
  const stateRef = firestore
    .collection(NOTIFICATION_REPEAT_STATES_COLLECTION)
    .doc(baseNotificationKey);

  try {
    return await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(stateRef);
      const state = snapshot.exists ? readRepeatState(snapshot.data()) : null;
      const now = request.createdAt;
      if (
        state !== null &&
        state.lastNotifiedAt.getTime() + intervalSeconds * MILLISECONDS_PER_SECOND >
          now.getTime()
      ) {
        return { status: "skipped" as const };
      }

      const repeatSeq = (state?.repeatSeq ?? 0) + 1;
      const requestId = createRepeatNotificationRequestId(rawBaseNotificationKey, repeatSeq);
      const requestRef = firestore.collection(NOTIFICATION_REQUESTS_COLLECTION).doc(requestId);
      const repeatRequest: NotificationRequest = {
        ...request,
        repeatNotification: {
          enabled: true,
          intervalSeconds,
        },
        baseNotificationKey,
        repeatSeq,
        isRepeat: true,
      };

      transaction.create(requestRef, toFirestoreNotificationRequest(repeatRequest));
      transaction.set(
        stateRef,
        {
          baseNotificationKey,
          rawBaseNotificationKey,
          ruleId: request.ruleId,
          guildId: request.guildId,
          battleType: request.battleType,
          worldId: request.source.worldId,
          battleDate: request.source.battleDate,
          ...(request.baseId === undefined ? {} : { castleId: normalizeCastleId(request.baseId) }),
          attackerGuildId: request.attackerGuildId ?? null,
          lastNotifiedAt: Timestamp.fromDate(now),
          repeatSeq,
          intervalSeconds,
          updatedAt: Timestamp.fromDate(now),
          expiresAt: Timestamp.fromDate(createRepeatStateExpiresAt(request.source.battleDate)),
        },
        { merge: true },
      );

      return { status: "created" as const };
    });
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return { status: "duplicate" };
    }
    throw error;
  }
}

function normalizeNotificationRule(
  ruleId: string,
  rawData: unknown,
): NormalizeNotificationRuleResult {
  if (!isRecord(rawData)) {
    return skipInvalidSchema();
  }

  const data = rawData as NotificationRuleData;
  if (data.schemaVersion !== 2) {
    return { status: "skipped", reason: "unsupportedVersion" };
  }
  if (data.battleType !== "guildBattle" && data.battleType !== "grandBattle") {
    return skipInvalidSchema();
  }
  if (typeof data.name !== "string" || data.name.trim().length === 0) {
    return skipInvalidSchema();
  }
  if (typeof data.enabled !== "boolean") {
    return skipInvalidSchema();
  }
  if (!isSafeInteger(data.sortOrder)) {
    return skipInvalidSchema();
  }

  const schedule = normalizeSchedule(data.schedule);
  const detailRuleEnabled = normalizeDetailRuleEnabled(data.detailRuleEnabled);
  const battleSide = normalizeBattleSide(data.battleSide);
  const guildFilter = normalizeGuildFilter(data);
  const detailConditions = detailRuleEnabled
    ? normalizeDetailConditions(data.detailConditions)
    : createEmptyDetailConditionRoot();
  const message = normalizeMessage(data.message);
  const repeatNotification = normalizeRepeatNotification(data.repeatNotification);
  const temporarySuspension = normalizeTemporarySuspension(data.temporarySuspension);

  if (
    schedule === null ||
    detailRuleEnabled === null ||
    battleSide === null ||
    guildFilter === null ||
    detailConditions === null ||
    message === null ||
    temporarySuspension === null
  ) {
    return skipInvalidSchema();
  }

  return {
    status: "accepted",
    rule: {
      id: ruleId,
      schemaVersion: 2,
      battleType: data.battleType,
      detailRuleEnabled,
      battleSide,
      name: data.name.trim(),
      enabled: data.enabled,
      sortOrder: data.sortOrder,
      schedule,
      guildFilter,
      detailConditions,
      message,
      repeatNotification,
      ...(temporarySuspension === undefined ? {} : { temporarySuspension }),
    },
  };
}

function normalizeBattleSide(value: unknown): NotificationBattleSide | null {
  if (value === undefined) {
    return "defense";
  }
  if (value === "defense" || value === "attack") {
    return value;
  }
  return null;
}

function normalizeDetailRuleEnabled(value: unknown): boolean | null {
  if (value === undefined) {
    return true;
  }
  return typeof value === "boolean" ? value : null;
}

function normalizeSchedule(value: unknown): NotificationRule["schedule"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const startTime = value.startTime;
  const endTime = value.endTime;
  if (typeof startTime !== "string" || parseStartTimeMinutes(startTime) === null) {
    return null;
  }

  if (endTime === undefined || endTime === null) {
    return {
      startTime,
      endTime: null,
    };
  }

  if (typeof endTime !== "string" || parseStartTimeMinutes(endTime) === null) {
    return null;
  }

  return {
    startTime,
    endTime,
  };
}

function normalizeGuildFilter(data: NotificationRuleData): string[] | null {
  return normalizeGuildIdList(data.guildFilter ?? data.attackerGuildIds ?? data.targetGuildIds);
}

function normalizeGuildIdList(value: unknown): string[] | null {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const guildIds: string[] = [];
  for (const guildId of value) {
    if (typeof guildId !== "string") {
      return null;
    }
    const trimmedGuildId = guildId.trim();
    if (trimmedGuildId.length === 0) {
      return null;
    }
    guildIds.push(trimmedGuildId);
  }

  const uniqueGuildIds = new Set(guildIds);
  if (uniqueGuildIds.size !== guildIds.length) {
    return null;
  }

  return guildIds;
}

function normalizeDetailConditions(value: unknown): NotificationDetailConditionRoot | null {
  if (!isRecord(value) || value.operator !== "OR" || !Array.isArray(value.children)) {
    return null;
  }

  const children: Array<NotificationDetailCondition | NotificationDetailConditionGroup> = [];
  for (const child of value.children) {
    const normalizedChild = normalizeDetailConditionChild(child);
    if (normalizedChild === null) {
      return null;
    }
    children.push(normalizedChild);
  }

  if (children.length === 0) {
    return null;
  }

  return {
    operator: "OR",
    children,
  };
}

function normalizeDetailConditionChild(
  value: unknown,
): NotificationDetailCondition | NotificationDetailConditionGroup | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.type === "condition") {
    return normalizeDetailCondition(value);
  }
  if (value.type !== "group") {
    return null;
  }
  if (value.operator !== "AND" && value.operator !== "OR") {
    return null;
  }
  if (!Array.isArray(value.children)) {
    return null;
  }
  if (value.children.length === 0) {
    return null;
  }

  const children: NotificationDetailCondition[] = [];
  for (const child of value.children) {
    if (!isRecord(child) || child.type === "group") {
      return null;
    }
    const normalizedChild = normalizeDetailCondition(child);
    if (normalizedChild === null) {
      return null;
    }
    children.push(normalizedChild);
  }

  return {
    type: "group",
    operator: value.operator,
    children,
  };
}

function createEmptyDetailConditionRoot(): NotificationDetailConditionRoot {
  return {
    operator: "OR",
    children: [],
  };
}

function normalizeDetailCondition(
  value: Record<string, unknown>,
): NotificationDetailCondition | null {
  if (value.field !== "defenseCount" && value.field !== "attackCount") {
    return null;
  }
  if (value.operator !== "<=" && value.operator !== ">=") {
    return null;
  }
  if (!isNonNegativeSafeInteger(value.value)) {
    return null;
  }

  return {
    type: "condition",
    field: value.field,
    operator: value.operator,
    value: value.value,
  };
}

function normalizeMessage(value: unknown): NotificationRule["message"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const usernameTemplate = value.usernameTemplate;
  const mention = normalizeMention(value.mention);
  const titleTemplate = value.titleTemplate;
  const bodyTemplate = value.bodyTemplate;
  if (
    typeof usernameTemplate !== "string" ||
    typeof titleTemplate !== "string" ||
    typeof bodyTemplate !== "string" ||
    mention === null
  ) {
    return null;
  }
  if (titleTemplate.trim().length === 0 || titleTemplate.length > TITLE_TEMPLATE_MAX_LENGTH) {
    return null;
  }

  return {
    usernameTemplate,
    mention,
    titleTemplate,
    bodyTemplate,
  };
}

function normalizeRepeatNotification(value: unknown): NotificationRule["repeatNotification"] {
  if (value === undefined || value === null || !isRecord(value)) {
    return {
      enabled: false,
      intervalSeconds: DEFAULT_REPEAT_INTERVAL_SECONDS,
    };
  }

  if (
    value.enabled !== true ||
    !isSafeInteger(value.intervalSeconds) ||
    value.intervalSeconds < MIN_REPEAT_INTERVAL_SECONDS ||
    value.intervalSeconds > MAX_REPEAT_INTERVAL_SECONDS
  ) {
    return {
      enabled: false,
      intervalSeconds: DEFAULT_REPEAT_INTERVAL_SECONDS,
    };
  }

  return {
    enabled: true,
    intervalSeconds: value.intervalSeconds,
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
    if (typeof value.customText !== "string" || value.customText.trim().length === 0) {
      return null;
    }
    return {
      type: "custom",
      customText: value.customText,
    };
  }

  return null;
}

function normalizeTemporarySuspension(
  value: unknown,
): NotificationRule["temporarySuspension"] | undefined | null {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value) || typeof value.expiresAt !== "string") {
    return null;
  }

  const expiresAtMilliseconds = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiresAtMilliseconds)) {
    return null;
  }

  return {
    expiresAt: value.expiresAt,
  };
}

function skipInvalidSchema(): NormalizeNotificationRuleResult {
  return {
    status: "skipped",
    reason: "invalidSchema",
  };
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function toFirestoreNotificationRequest(request: NotificationRequest): Record<string, unknown> {
  return {
    guildId: request.guildId,
    battleType: request.battleType,
    ruleId: request.ruleId,
    ruleName: request.ruleName,
    detailRuleEnabled: request.detailRuleEnabled,
    duplicateKey: request.duplicateKey,
    activeTimeWindow: request.activeTimeWindow,
    ...(request.baseId === undefined ? {} : { baseId: request.baseId }),
    ...(request.baseName === undefined ? {} : { baseName: request.baseName }),
    ...(request.castleName === undefined ? {} : { castleName: request.castleName }),
    ...(request.gvgCastleState === undefined ? {} : { gvgCastleState: request.gvgCastleState }),
    ...(request.ownerGuildId === undefined ? {} : { ownerGuildId: request.ownerGuildId }),
    ...(request.ownerGuildName === undefined ? {} : { ownerGuildName: request.ownerGuildName }),
    ...(request.attackerGuildId ? { attackerGuildId: request.attackerGuildId } : {}),
    ...(request.attackerGuildName === undefined ? {} : { attackerGuildName: request.attackerGuildName }),
    ...(request.attackGuildId === undefined ? {} : { attackGuildId: request.attackGuildId }),
    ...(request.attackGuildName === undefined ? {} : { attackGuildName: request.attackGuildName }),
    ...(request.defenseGuildId === undefined ? {} : { defenseGuildId: request.defenseGuildId }),
    ...(request.defenseGuildName === undefined ? {} : { defenseGuildName: request.defenseGuildName }),
    ...(request.defenseCount === undefined ? {} : { defenseCount: request.defenseCount }),
    ...(request.attackCount === undefined ? {} : { attackCount: request.attackCount }),
    ...(request.repeatNotification === undefined
      ? {}
      : { repeatNotification: request.repeatNotification }),
    ...(request.baseNotificationKey === undefined
      ? {}
      : { baseNotificationKey: request.baseNotificationKey }),
    ...(request.repeatSeq === undefined ? {} : { repeatSeq: request.repeatSeq }),
    ...(request.isRepeat === undefined ? {} : { isRepeat: request.isRepeat }),
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
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRepeatState(data: unknown): {
  lastNotifiedAt: Date;
  repeatSeq: number;
} | null {
  if (!isRecord(data)) {
    return null;
  }

  const lastNotifiedAt = data.lastNotifiedAt;
  if (!isTimestampLike(lastNotifiedAt) || !isNonNegativeSafeInteger(data.repeatSeq)) {
    return null;
  }

  return {
    lastNotifiedAt: lastNotifiedAt.toDate(),
    repeatSeq: data.repeatSeq,
  };
}

function isTimestampLike(value: unknown): value is { toDate(): Date } {
  return isRecord(value) && typeof value.toDate === "function";
}

function normalizeCastleId(baseId: string): string {
  const prefix = "castle-";
  return baseId.startsWith(prefix) ? baseId.slice(prefix.length) : baseId;
}

function createRepeatStateExpiresAt(battleDate: string): Date {
  const battleDateStart = Date.parse(`${battleDate}T00:00:00.000Z`);
  const baseTime = Number.isFinite(battleDateStart) ? battleDateStart : Date.now();
  return new Date(baseTime + REPEAT_STATE_TTL_DAYS * MILLISECONDS_PER_DAY);
}
