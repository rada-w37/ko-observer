import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import {
  createNotificationRequest,
  loadNotificationRules,
} from "./notificationRepository.js";
import type { NotificationRequest } from "../notifications/domain/notificationDomain.js";

test("loads valid notification rules and skips invalid documents", async () => {
  const firestore = new FakeFirestore();
  firestore.seedRule("guild-a", "rule-a", createRuleData());
  firestore.seedRule("guild-a", "rule-b", { ...createRuleData(), conditions: { startTime: "9:00" } });

  const result = await loadNotificationRules(firestore as unknown as Firestore, "guild-a");

  assert.equal(result.rules.length, 1);
  assert.equal(result.skippedInvalidCount, 1);
  assert.deepEqual(result.rules[0], {
    id: "rule-a",
    battleType: "guildBattle",
    name: "Rule A",
    enabled: true,
    conditions: {
      startTime: "20:50",
      defenseCountMax: 3,
      attackCountMin: null,
    },
    message: {
      usernameTemplate: "KOO",
      mention: { type: "here" },
      titleTemplate: "{拠点名}",
      bodyTemplate: "{防御数}",
    },
  });
  assert.equal(firestore.collectionIds.includes("notificationDestinations"), false);
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
    battleType: "guildBattle",
    name: "Rule A",
    enabled: true,
    conditions: {
      startTime: "20:50",
      defenseCountMax: 3,
      attackCountMin: null,
    },
    message: {
      usernameTemplate: "KOO",
      mention: { type: "here" },
      titleTemplate: "{拠点名}",
      bodyTemplate: "{防御数}",
    },
  };
}

function createRequest(): NotificationRequest {
  return {
    guildId: "guild-a",
    battleType: "guildBattle",
    ruleId: "rule-a",
    ruleName: "Rule A",
    duplicateKey: "duplicate-a",
    baseId: "castle-1",
    baseName: "拠点1",
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
