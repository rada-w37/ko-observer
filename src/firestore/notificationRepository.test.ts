import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  createNotificationRequest,
  createRepeatNotificationRequest,
  loadNotificationRules,
} from "./notificationRepository.js";
import type { NotificationRequest } from "../notifications/domain/notificationDomain.js";

test("loads Guild Battle and Grand Battle v2 rules and classifies skipped documents", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "rule-a", createRuleData());
  firestore.seedRule("guild-a", "legacy-rule", { ...createRuleData(), schemaVersion: 1 });
  firestore.seedRule("guild-a", "grand-rule", {
    ...createRuleData(),
    battleType: "grandBattle",
    guildFilter: [],
  });
  firestore.seedRule("guild-a", "invalid-rule", {
    ...createRuleData(),
    sortOrder: Number.NaN,
  });

  const result = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");

  assert.equal(result.rules.length, 2);
  assert.equal(result.skippedUnsupportedVersionCount, 1);
  assert.equal(result.skippedUnsupportedGrandBattleCount, 0);
  assert.equal(result.skippedInvalidSchemaCount, 1);
  assert.deepEqual(result.rules[0], {
    id: "rule-a",
    schemaVersion: 2,
    battleType: "guildBattle",
    detailRuleEnabled: true,
    battleSide: "defense",
    name: "Rule A",
    enabled: true,
    sortOrder: 3,
    schedule: {
      startTime: "20:50",
      endTime: null,
    },
    guildFilter: ["guild-b", "guild-c"],
    detailConditions: {
      operator: "OR",
      children: [
        {
          type: "condition",
          field: "defenseCount",
          operator: "<=",
          value: 3,
        },
      ],
    },
    message: {
      usernameTemplate: "KOO",
      mention: { type: "custom", customText: "<@123>" },
      titleTemplate: "{諡轤ｹ蜷閤",
      bodyTemplate: "{髦ｲ蠕｡謨ｰ}",
    },
    repeatNotification: {
      enabled: false,
      intervalSeconds: 300,
    },
    temporarySuspension: {
      expiresAt: "2026-06-17T12:30:00.000Z",
    },
  });
  assert.equal(result.rules[1]?.id, "grand-rule");
  assert.equal(result.rules[1]?.battleType, "grandBattle");
  assert.equal(result.rules[1]?.battleSide, "defense");
  assert.deepEqual(result.rules[1]?.guildFilter, []);
  assert.equal(firestore.collectionIds.includes("notificationDestinations"), false);
});

test("uses document id as canonical and defaults missing optional v2 fields", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "document-rule-id", {
    ...createRuleData(),
    id: "mismatched-data-id",
    detailRuleEnabled: undefined,
    battleSide: undefined,
    guildFilter: undefined,
  });

  const result = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");

  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0]?.id, "document-rule-id");
  assert.equal(result.rules[0]?.detailRuleEnabled, true);
  assert.equal(result.rules[0]?.battleSide, "defense");
  assert.deepEqual(result.rules[0]?.guildFilter, []);
  assert.deepEqual(result.rules[0]?.repeatNotification, {
    enabled: false,
    intervalSeconds: 300,
  });
  assert.equal(result.skippedInvalidSchemaCount, 0);
});

test("normalizes invalid repeatNotification as disabled without skipping rules", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "repeat-enabled", {
    ...createRuleData(),
    repeatNotification: { enabled: true, intervalSeconds: 30 },
  });
  firestore.seedRule("guild-a", "repeat-short-interval", {
    ...createRuleData(),
    repeatNotification: { enabled: true, intervalSeconds: 29 },
  });
  firestore.seedRule("guild-a", "repeat-too-long", {
    ...createRuleData(),
    repeatNotification: { enabled: true, intervalSeconds: 2701 },
  });
  firestore.seedRule("guild-a", "repeat-invalid", {
    ...createRuleData(),
    repeatNotification: { enabled: true, intervalSeconds: "60" },
  });
  firestore.seedRule("guild-a", "repeat-fraction", {
    ...createRuleData(),
    repeatNotification: { enabled: true, intervalSeconds: 60.5 },
  });
  firestore.seedRule("guild-a", "repeat-null-interval", {
    ...createRuleData(),
    repeatNotification: { enabled: true, intervalSeconds: null },
  });
  firestore.seedRule("guild-a", "repeat-null", {
    ...createRuleData(),
    repeatNotification: null,
  });
  firestore.seedRule("guild-a", "repeat-disabled", {
    ...createRuleData(),
    repeatNotification: { enabled: false, intervalSeconds: 60 },
  });
  firestore.seedRule("guild-a", "repeat-non-object", {
    ...createRuleData(),
    repeatNotification: true,
  });

  const result = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");

  assert.equal(result.rules.length, 9);
  assert.deepEqual(result.rules[0]?.repeatNotification, {
    enabled: true,
    intervalSeconds: 30,
  });
  assert.deepEqual(result.rules[1]?.repeatNotification, {
    enabled: false,
    intervalSeconds: 300,
  });
  assert.deepEqual(result.rules[2]?.repeatNotification, {
    enabled: false,
    intervalSeconds: 300,
  });
  assert.deepEqual(result.rules[3]?.repeatNotification, {
    enabled: false,
    intervalSeconds: 300,
  });
  assert.deepEqual(result.rules[4]?.repeatNotification, {
    enabled: false,
    intervalSeconds: 300,
  });
  assert.deepEqual(result.rules[5]?.repeatNotification, {
    enabled: false,
    intervalSeconds: 300,
  });
  assert.deepEqual(result.rules[6]?.repeatNotification, {
    enabled: false,
    intervalSeconds: 300,
  });
  assert.deepEqual(result.rules[7]?.repeatNotification, {
    enabled: false,
    intervalSeconds: 300,
  });
  assert.deepEqual(result.rules[8]?.repeatNotification, {
    enabled: false,
    intervalSeconds: 300,
  });
  assert.equal(result.skippedInvalidSchemaCount, 0);
});

test("normalizes legacy attackerGuildIds into guildFilter", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "legacy-filter", {
    ...createRuleData(),
    guildFilter: undefined,
    attackerGuildIds: [" guild-x ", "guild-y"],
  });

  const result = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");

  assert.equal(result.rules.length, 1);
  assert.deepEqual(result.rules[0]?.guildFilter, ["guild-x", "guild-y"]);
});

test("skips invalid v2 schema fields", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "invalid-target", {
    ...createRuleData(),
    guildFilter: ["guild-b", " guild-b "],
  });
  firestore.seedRule("guild-a", "invalid-end-time", {
    ...createRuleData(),
    schedule: {
      startTime: "20:50",
      endTime: "",
    },
  });
  firestore.seedRule("guild-a", "invalid-nested-group", {
    ...createRuleData(),
    detailConditions: {
      operator: "OR",
      children: [
        {
          type: "group",
          operator: "AND",
          children: [
            {
              type: "group",
              operator: "OR",
              children: [],
            },
          ],
        },
      ],
    },
  });
  firestore.seedRule("guild-a", "invalid-condition", {
    ...createRuleData(),
    detailConditions: {
      operator: "OR",
      children: [
        {
          type: "condition",
          field: "defensePartyCount",
          operator: "<=",
          value: 3,
        },
      ],
    },
  });
  firestore.seedRule("guild-a", "invalid-battle-side", {
    ...createRuleData(),
    battleSide: "both",
  });

  const result = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");

  assert.equal(result.rules.length, 0);
  assert.equal(result.skippedInvalidSchemaCount, 5);
});

test("skips detail-rule-on rules without detail condition children", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "empty-root", {
    ...createRuleData(),
    repeatNotification: { enabled: true, intervalSeconds: 60 },
    detailConditions: {
      operator: "OR",
      children: [],
    },
  });
  firestore.seedRule("guild-a", "empty-group", {
    ...createRuleData(),
    repeatNotification: { enabled: true, intervalSeconds: 60 },
    detailConditions: {
      operator: "OR",
      children: [
        {
          type: "group",
          operator: "AND",
          children: [],
        },
      ],
    },
  });

  const result = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");

  assert.equal(result.rules.length, 0);
  assert.equal(result.skippedInvalidSchemaCount, 2);
});

test("skips detail-rule-on rules with empty detail condition groups", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "mixed-groups", {
    ...createRuleData(),
    detailConditions: {
      operator: "OR",
      children: [
        {
          type: "group",
          operator: "AND",
          children: [],
        },
        {
          type: "condition",
          field: "defenseCount",
          operator: "<=",
          value: 3,
        },
      ],
    },
  });

  const result = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");

  assert.equal(result.rules.length, 0);
  assert.equal(result.skippedInvalidSchemaCount, 1);
});

test("loads detail-rule-off rules without detail conditions", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "time-only", {
    ...createRuleData(),
    detailRuleEnabled: false,
    detailConditions: undefined,
  });

  const result = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");

  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0]?.detailRuleEnabled, false);
  assert.deepEqual(result.rules[0]?.detailConditions, {
    operator: "OR",
    children: [],
  });
});

test("validates schedule time bounds", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "valid-min", {
    ...createRuleData(),
    schedule: {
      startTime: "00:00",
      endTime: null,
    },
  });
  firestore.seedRule("guild-a", "valid-max", {
    ...createRuleData(),
    schedule: {
      startTime: "23:59",
      endTime: "23:59",
    },
  });
  firestore.seedRule("guild-a", "invalid-hour", {
    ...createRuleData(),
    schedule: {
      startTime: "24:00",
      endTime: null,
    },
  });
  firestore.seedRule("guild-a", "invalid-minute", {
    ...createRuleData(),
    schedule: {
      startTime: "12:99",
      endTime: null,
    },
  });
  firestore.seedRule("guild-a", "invalid-both", {
    ...createRuleData(),
    schedule: {
      startTime: "99:99",
      endTime: null,
    },
  });

  const result = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");

  assert.equal(result.rules.length, 2);
  assert.deepEqual(
    result.rules.map((rule) => rule.id),
    ["valid-min", "valid-max"],
  );
  assert.equal(result.skippedInvalidSchemaCount, 3);
});

test("creates notification request with stable document id", async () => {
  const firestore = new FakeFirestore();
  const result = await createNotificationRequest(
    firestore as unknown as Firestore,
    "request-a",
    createRequest(),
  );

  assert.deepEqual(result, { status: "created" });
  assert.equal(firestore.createdRequestIds[0], "request-a");
  const stored = firestore.requestData.get("request-a");
  assert.equal(stored?.guildId, "guild-a");
  assert.equal(stored?.status, "pending");
  assert.equal(stored?.detailRuleEnabled, true);
  assert.equal(stored?.activeTimeWindow, "20:50-open");
  assert.equal(stored?.gvgCastleState, 1);
  assert.equal(stored?.ownerGuildId, "guild-a");
  assert.equal(stored?.ownerGuildName, "Guild A");
  assert.equal(stored?.attackerGuildId, "guild-b");
  assert.equal(stored?.attackerGuildName, "Guild B");
  assert.equal(stored?.attackGuildId, "guild-b");
  assert.equal(stored?.attackGuildName, "Guild B");
  assert.equal(stored?.defenseGuildId, "guild-a");
  assert.equal(stored?.defenseGuildName, "Guild A");
});

test("loads and creates requests with empty message body and username", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "empty-message-rule", {
    ...createRuleData(),
    message: {
      usernameTemplate: "",
      mention: { type: "none" },
      titleTemplate: "{隲｡・ｰ霓､・ｹ陷ｷ髢､",
      bodyTemplate: "",
    },
  });

  const loaded = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");
  assert.equal(loaded.rules.length, 1);
  assert.deepEqual(loaded.rules[0]?.message, {
    usernameTemplate: "",
    mention: { type: "none" },
    titleTemplate: "{隲｡・ｰ霓､・ｹ陷ｷ髢､",
    bodyTemplate: "",
  });

  await createNotificationRequest(
    firestore as unknown as Firestore,
    "request-empty-message",
    createRequest({
      message: {
        username: "",
        mentionText: "",
        title: "title",
        body: "",
      },
    }),
  );

  const stored = firestore.requestData.get("request-empty-message");
  assert.deepEqual(stored?.message, {
    username: "",
    mentionText: "",
    title: "title",
    body: "",
  });
});

test("requires title template and accepts raw summary up to 120 chars", async () => {
  const firestore = new FakeFirestore();
  const maxLengthTitle = "x".repeat(120);
  firestore.seedRule("guild-a", "valid-summary", {
    ...createRuleData(),
    message: {
      usernameTemplate: "",
      mention: { type: "none" },
      titleTemplate: maxLengthTitle,
      bodyTemplate: "",
    },
  });
  firestore.seedRule("guild-a", "empty-summary", {
    ...createRuleData(),
    message: {
      usernameTemplate: "",
      mention: { type: "none" },
      titleTemplate: "",
      bodyTemplate: "",
    },
  });
  firestore.seedRule("guild-a", "blank-summary", {
    ...createRuleData(),
    message: {
      usernameTemplate: "",
      mention: { type: "none" },
      titleTemplate: "   ",
      bodyTemplate: "",
    },
  });
  firestore.seedRule("guild-a", "too-long-summary", {
    ...createRuleData(),
    message: {
      usernameTemplate: "",
      mention: { type: "none" },
      titleTemplate: "x".repeat(121),
      bodyTemplate: "",
    },
  });

  const result = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");

  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0]?.id, "valid-summary");
  assert.equal(result.rules[0]?.message.titleTemplate, maxLengthTitle);
  assert.equal(result.skippedInvalidSchemaCount, 3);
});

test("treats already existing notification request as duplicate", async () => {
  const firestore = new FakeFirestore();
  await createNotificationRequest(firestore as unknown as Firestore, "request-a", createRequest());
  const result = await createNotificationRequest(
    firestore as unknown as Firestore,
    "request-a",
    createRequest(),
  );

  assert.deepEqual(result, { status: "duplicate" });
  assert.deepEqual(firestore.createdRequestIds, ["request-a"]);
});

test("creates first repeat notification request and repeat state in a transaction", async () => {
  const firestore = new FakeFirestore();
  const request = createRequest();
  const result = await createRepeatNotificationRequest(
    firestore as unknown as Firestore,
    request,
    30,
  );

  assert.deepEqual(result, { status: "created" });
  assert.equal(firestore.createdRequestIds.length, 1);
  assert.notEqual(firestore.createdRequestIds[0], "duplicate-a");
  const storedRequest = firestore.requestData.get(firestore.createdRequestIds[0] ?? "");
  assert.deepEqual(storedRequest?.repeatNotification, {
    enabled: true,
    intervalSeconds: 30,
  });
  assert.equal(storedRequest?.isRepeat, true);
  assert.equal(storedRequest?.repeatSeq, 1);
  assert.equal(storedRequest?.duplicateKey, "duplicate-a");

  const state = firestore.repeatStateData.get(storedRequest?.baseNotificationKey as string);
  assert.equal(state?.rawBaseNotificationKey, "duplicate-a");
  assert.equal(state?.repeatSeq, 1);
  assert.equal(state?.intervalSeconds, 30);
  assert.equal(state?.castleId, "1");
  assert.equal(state?.attackerGuildId, "guild-b");
  assert.equal(typeof state?.expiresAt, "object");
});

test("skips repeat notification before interval and keeps lastNotifiedAt", async () => {
  const firestore = new FakeFirestore();
  await createRepeatNotificationRequest(firestore as unknown as Firestore, createRequest(), 60);
  const stateBefore = new Map(firestore.repeatStateData);

  const result = await createRepeatNotificationRequest(
    firestore as unknown as Firestore,
    createRequest({ createdAt: new Date("2026-06-17T11:55:59.000Z") }),
    60,
  );

  assert.deepEqual(result, { status: "skipped" });
  assert.equal(firestore.createdRequestIds.length, 1);
  assert.deepEqual(firestore.repeatStateData, stateBefore);
});

test("creates next repeat notification after interval using current interval seconds", async () => {
  const firestore = new FakeFirestore();
  await createRepeatNotificationRequest(firestore as unknown as Firestore, createRequest(), 300);

  const result = await createRepeatNotificationRequest(
    firestore as unknown as Firestore,
    createRequest({ createdAt: new Date("2026-06-17T11:56:01.000Z") }),
    60,
  );

  assert.deepEqual(result, { status: "created" });
  assert.equal(firestore.createdRequestIds.length, 2);
  const storedRequest = firestore.requestData.get(firestore.createdRequestIds[1] ?? "");
  const firstStoredRequest = firestore.requestData.get(firestore.createdRequestIds[0] ?? "");
  assert.equal(storedRequest?.repeatSeq, 2);
  assert.equal(storedRequest?.baseNotificationKey, firstStoredRequest?.baseNotificationKey);
  const state = firestore.repeatStateData.get(storedRequest?.baseNotificationKey as string);
  assert.equal(state?.repeatSeq, 2);
  assert.equal(state?.intervalSeconds, 60);
});

test("treats duplicate repeat request document as duplicate", async () => {
  const firestore = new FakeFirestore();
  await createRepeatNotificationRequest(firestore as unknown as Firestore, createRequest(), 60);
  const state = firestore.repeatStateData.values().next().value;
  if (!state) {
    throw new Error("repeat state was not created");
  }
  state.lastNotifiedAt = Timestamp.fromDate(new Date("2026-06-17T11:55:00.000Z"));
  state.repeatSeq = 0;

  const result = await createRepeatNotificationRequest(
    firestore as unknown as Firestore,
    createRequest({ createdAt: new Date("2026-06-17T11:56:00.000Z") }),
    60,
  );

  assert.deepEqual(result, { status: "duplicate" });
  assert.equal(firestore.createdRequestIds.length, 1);
});

function createRuleData(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    battleType: "guildBattle",
    detailRuleEnabled: true,
    battleSide: "defense",
    name: "Rule A",
    enabled: true,
    sortOrder: 3,
    schedule: {
      startTime: "20:50",
      endTime: null,
    },
    guildFilter: [" guild-b ", "guild-c"],
    detailConditions: {
      operator: "OR",
      children: [
        {
          type: "condition",
          field: "defenseCount",
          operator: "<=",
          value: 3,
        },
      ],
    },
    message: {
      usernameTemplate: "KOO",
      mention: { type: "custom", customText: "<@123>" },
      titleTemplate: "{諡轤ｹ蜷閤",
      bodyTemplate: "{髦ｲ蠕｡謨ｰ}",
    },
    temporarySuspension: {
      expiresAt: "2026-06-17T12:30:00.000Z",
    },
  };
}

function createRequest(overrides: Partial<NotificationRequest> = {}): NotificationRequest {
  return {
    guildId: "guild-a",
    battleType: "guildBattle",
    ruleId: "rule-a",
    ruleName: "Rule A",
    detailRuleEnabled: true,
    duplicateKey: "duplicate-a",
    activeTimeWindow: "20:50-open",
    baseId: "castle-1",
    baseName: "ブラッセル",
    castleName: "ブラッセル",
    gvgCastleState: 1,
    ownerGuildId: "guild-a",
    ownerGuildName: "Guild A",
    attackerGuildId: "guild-b",
    attackerGuildName: "Guild B",
    attackGuildId: "guild-b",
    attackGuildName: "Guild B",
    defenseGuildId: "guild-a",
    defenseGuildName: "Guild A",
    defenseCount: 2,
    attackCount: 5,
    message: {
      username: "KOO",
      mentionText: "@here",
      title: "title",
      body: "body",
    },
    source: {
      observedAt: new Date("2026-06-17T11:55:00.000Z"),
      battleDate: "2026-06-17",
      worldId: "1001",
      runId: "run-a",
    },
    status: "pending",
    createdAt: new Date("2026-06-17T11:55:00.000Z"),
    ...overrides,
  };
}

class FakeFirestore {
  readonly collectionIds: string[] = [];
  readonly requestData = new Map<string, Record<string, unknown>>();
  readonly repeatStateData = new Map<string, Record<string, unknown>>();
  readonly createdRequestIds: string[] = [];
  private readonly ruleData = new Map<string, Map<string, Record<string, unknown>>>();

  collection(collectionId: string): FakeCollectionReference {
    this.collectionIds.push(collectionId);
    return new FakeCollectionReference(this, [collectionId]);
  }

  seedRule(guildId: string, ruleId: string, data: Record<string, unknown>): void {
    const rules = this.ruleData.get(guildId) ?? new Map<string, Record<string, unknown>>();
    rules.set(ruleId, data);
    this.ruleData.set(guildId, rules);
  }

  listRules(guildId: string): FakeDocumentSnapshot[] {
    return [...(this.ruleData.get(guildId) ?? new Map()).entries()].map(
      ([ruleId, data]) => new FakeDocumentSnapshot(ruleId, data),
    );
  }

  createRequest(requestId: string, data: Record<string, unknown>): void {
    if (this.requestData.has(requestId)) {
      throw Object.assign(new Error("already exists"), { code: 6 });
    }
    this.createdRequestIds.push(requestId);
    this.requestData.set(requestId, data);
  }

  async runTransaction<T>(updateFunction: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    return updateFunction(new FakeTransaction(this));
  }
}

class FakeTransaction {
  constructor(private readonly firestore: FakeFirestore) {}

  async get(ref: FakeDocumentReference): Promise<FakeDocumentSnapshot> {
    const [collectionId, documentId] = ref.path;
    assert.equal(typeof documentId, "string");
    if (collectionId !== "notificationRepeatStates") {
      throw new Error(`unexpected transaction get path: ${ref.path.join("/")}`);
    }

    const data = this.firestore.repeatStateData.get(documentId);
    return new FakeDocumentSnapshot(documentId, data, data !== undefined);
  }

  create(ref: FakeDocumentReference, data: Record<string, unknown>): void {
    const [collectionId, documentId] = ref.path;
    assert.equal(collectionId, "notificationRequests");
    assert.equal(typeof documentId, "string");
    this.firestore.createRequest(documentId, data);
  }

  set(
    ref: FakeDocumentReference,
    data: Record<string, unknown>,
    options?: { merge: boolean },
  ): void {
    const [collectionId, documentId] = ref.path;
    assert.equal(collectionId, "notificationRepeatStates");
    assert.equal(typeof documentId, "string");
    const previous = options?.merge ? this.firestore.repeatStateData.get(documentId) ?? {} : {};
    this.firestore.repeatStateData.set(documentId, {
      ...previous,
      ...data,
    });
  }
}

class FakeCollectionReference {
  constructor(
    private readonly firestore: FakeFirestore,
    private readonly path: string[],
  ) {}

  doc(documentId: string): FakeDocumentReference {
    return new FakeDocumentReference(this.firestore, [...this.path, documentId]);
  }
}

class FakeDocumentReference {
  constructor(
    private readonly firestore: FakeFirestore,
    readonly path: string[],
  ) {}

  collection(collectionId: string): FakeRuleCollectionReference {
    return new FakeRuleCollectionReference(this.firestore, [...this.path, collectionId]);
  }

  async create(data: Record<string, unknown>): Promise<void> {
    const [collectionId, documentId] = this.path;
    assert.equal(collectionId, "notificationRequests");
    assert.equal(typeof documentId, "string");
    this.firestore.createRequest(documentId, data);
  }
}

class FakeRuleCollectionReference {
  constructor(
    private readonly firestore: FakeFirestore,
    private readonly path: string[],
  ) {}

  async get(): Promise<{ docs: FakeDocumentSnapshot[] }> {
    const [collectionId, guildId, childCollectionId] = this.path;
    assert.equal(collectionId, "guildShares");
    assert.equal(childCollectionId, "notificationRules");
    assert.equal(typeof guildId, "string");
    return {
      docs: this.firestore.listRules(guildId),
    };
  }
}

class FakeDocumentSnapshot {
  constructor(
    readonly id: string,
    private readonly value: Record<string, unknown> | undefined,
    readonly exists = true,
  ) {}

  data(): Record<string, unknown> | undefined {
    return this.value;
  }
}
