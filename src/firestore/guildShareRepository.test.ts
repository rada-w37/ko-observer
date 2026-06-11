import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { loadMonitorGuildTargetFromGuildShares } from "./guildShareRepository.js";

test("loads one monitor target from guildShares", async () => {
  const firestore = new FakeFirestore();
  firestore.seed("111111111037", {
    guildName: "Guild A",
    world: 37,
  });

  const result = await loadMonitorGuildTargetFromGuildShares(firestore as unknown as Firestore);

  assert.deepEqual(result, {
    status: "ok",
    worldId: "1037",
    guildId: "111111111037",
    guildName: "Guild A",
  });
});

test("returns empty when guildShares has no documents", async () => {
  const result = await loadMonitorGuildTargetFromGuildShares(
    new FakeFirestore() as unknown as Firestore,
  );

  assert.deepEqual(result, {
    status: "empty",
    message: "No guild configuration found.",
  });
});

test("returns multiple when guildShares has more than one document", async () => {
  const firestore = new FakeFirestore();
  firestore.seed("guild-a", { guildName: "A", world: 1 });
  firestore.seed("guild-b", { guildName: "B", world: 2 });

  const result = await loadMonitorGuildTargetFromGuildShares(firestore as unknown as Firestore);

  assert.deepEqual(result, {
    status: "multiple",
    message: "Multiple guild configurations found.",
    count: 2,
  });
});

test("throws on invalid world", async () => {
  const firestore = new FakeFirestore();
  firestore.seed("guild-a", { guildName: "A", world: 1000 });

  await assert.rejects(
    () => loadMonitorGuildTargetFromGuildShares(firestore as unknown as Firestore),
    /world must be an integer between 1 and 999/,
  );
});

class FakeFirestore {
  private readonly data = new Map<string, Record<string, unknown>>();

  collection(collectionId: string): FakeCollectionReference {
    assert.equal(collectionId, "guildShares");
    return new FakeCollectionReference(this);
  }

  seed(documentId: string, value: Record<string, unknown>): void {
    this.data.set(documentId, value);
  }

  listDocumentIds(): string[] {
    return [...this.data.keys()];
  }

  get(documentId: string): Record<string, unknown> | undefined {
    return this.data.get(documentId);
  }
}

class FakeCollectionReference {
  constructor(private readonly firestore: FakeFirestore) {}

  async listDocuments(): Promise<FakeDocumentReference[]> {
    return this.firestore
      .listDocumentIds()
      .map((documentId) => new FakeDocumentReference(this.firestore, documentId));
  }
}

class FakeDocumentReference {
  constructor(
    private readonly firestore: FakeFirestore,
    readonly id: string,
  ) {}

  async get(): Promise<{ data: () => Record<string, unknown> | undefined }> {
    return {
      data: () => this.firestore.get(this.id),
    };
  }
}
