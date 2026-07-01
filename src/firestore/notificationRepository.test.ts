import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import {
  createNotificationRequest,
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
    targetGuildIds: [],
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
    battleSide: "defense",
    name: "Rule A",
    enabled: true,
    sortOrder: 3,
    schedule: {
      startTime: "20:50",
      endTime: null,
    },
    targetGuildIds: ["guild-b", "guild-c"],
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
  });
  assert.equal(result.rules[1]?.id, "grand-rule");
  assert.equal(result.rules[1]?.battleType, "grandBattle");
  assert.equal(result.rules[1]?.battleSide, "defense");
  assert.deepEqual(result.rules[1]?.targetGuildIds, []);
  assert.equal(firestore.collectionIds.includes("notificationDestinations"), false);
});

test("uses document id as canonical and defaults missing optional v2 fields", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "document-rule-id", {
    ...createRuleData(),
    id: "mismatched-data-id",
    battleSide: undefined,
    targetGuildIds: undefined,
  });

  const result = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");

  assert.equal(result.rules.length, 1);
  assert.equal(result.rules[0]?.id, "document-rule-id");
  assert.equal(result.rules[0]?.battleSide, "defense");
  assert.deepEqual(result.rules[0]?.targetGuildIds, []);
  assert.equal(result.skippedInvalidSchemaCount, 0);
});

test("skips invalid v2 schema fields", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "invalid-target", {
    ...createRuleData(),
    targetGuildIds: ["guild-b", " guild-b "],
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

test("loads rules without detail condition children", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "empty-root", {
    ...createRuleData(),
    detailConditions: {
      operator: "OR",
      children: [],
    },
  });
  firestore.seedRule("guild-a", "empty-group", {
    ...createRuleData(),
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

  assert.equal(result.rules.length, 2);
  assert.deepEqual(result.rules[0]?.detailConditions, {
    operator: "OR",
    children: [],
  });
  assert.deepEqual(result.rules[1]?.detailConditions, {
    operator: "OR",
    children: [],
  });
  assert.equal(result.skippedInvalidSchemaCount, 0);
});

test("removes empty groups while keeping non-empty detail conditions", async () => {
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

  assert.equal(result.rules.length, 1);
  assert.deepEqual(result.rules[0]?.detailConditions, {
    operator: "OR",
    children: [
      {
        type: "condition",
        field: "defenseCount",
        operator: "<=",
        value: 3,
      },
    ],
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

function createRuleData(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    battleType: "guildBattle",
    battleSide: "defense",
    name: "Rule A",
    enabled: true,
    sortOrder: 3,
    schedule: {
      startTime: "20:50",
      endTime: null,
    },
    targetGuildIds: [" guild-b ", "guild-c"],
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
    duplicateKey: "duplicate-a",
    baseId: "castle-1",
    baseName: "ブラッセル",
    castleName: "ブラッセル",
    attackerGuildId: "guild-b",
    attackerGuildName: "Guild B",
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
    private readonly path: string[],
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
    private readonly value: Record<string, unknown>,
  ) {}

  data(): Record<string, unknown> {
    return this.value;
  }
}
