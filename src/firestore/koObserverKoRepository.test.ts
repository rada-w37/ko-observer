import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import {
  clearGuildKoTotals,
  initializePhase5KoObserverRun,
  writeKoObserverRunMeta,
  writeCastleKoDetail,
  writeGuildKoTotals,
  writeSeedGuildKoTotals,
} from "./koObserverKoRepository.js";

test("clears Phase5 collections and writes run meta on startup", async () => {
  const firestore = new FakeFirestore();
  firestore.seed("koObserverRuns/castleKoDetails/castleKoDetails/1", { stale: true });
  firestore.seed("koObserverViews/guildKoTotals/guildKoTotals/1001", { stale: true });

  const result = await initializePhase5KoObserverRun(
    firestore as unknown as Firestore,
    new Date("2026-06-10T11:40:00.000Z"),
  );

  assert.equal(
    firestore.has("koObserverRuns/castleKoDetails/castleKoDetails/1"),
    false,
  );
  assert.equal(
    firestore.has("koObserverViews/guildKoTotals/guildKoTotals/1001"),
    false,
  );
  assert.equal(firestore.has("koObserverRuns/meta"), true);
  assert.deepEqual(result, {
    deletedCastleKoDetailsCount: 1,
    deletedGuildKoTotalsCount: 1,
  });
});

test("writes castle detail without internal debug fields", async () => {
  const firestore = new FakeFirestore();

  await writeCastleKoDetail(firestore as unknown as Firestore, {
    castleId: 1,
    updatedAt: new Date("2026-06-10T11:45:30.000Z"),
    lastObservedAt: new Date("2026-06-10T11:45:30.000Z"),
    defender: {
      guildId: "1001001",
      guildName: "Defender",
      koVictimCount: 7,
      lastCheckpointSlot: 1,
      updatedAt: new Date("2026-06-10T11:45:30.000Z"),
    },
    attacker: {
      guildId: "2002001",
      guildName: "Attacker",
      koVictimCount: 0,
      lastCheckpointSlot: 1,
      updatedAt: new Date("2026-06-10T11:45:30.000Z"),
    },
  });

  const stored = firestore.get("koObserverRuns/castleKoDetails/castleKoDetails/1") as {
    unknownVictimKo?: number;
    suspiciousSwitch?: boolean;
    defender: {
      koVictimCount: number;
    };
  };
  assert.equal(stored.unknownVictimKo, undefined);
  assert.equal(stored.suspiciousSwitch, undefined);
  assert.equal(stored.defender.koVictimCount, 7);
});

test("writes guild total without guildId field and keeps larger total", async () => {
  const firestore = new FakeFirestore();
  firestore.seed("koObserverViews/guildKoTotals/guildKoTotals/1001001", {
    totalVictimKoCount: 9,
  });

  await writeGuildKoTotals(
    firestore as unknown as Firestore,
    new Map([
      [
        "1001001",
        {
          guildName: "Defender",
          totalVictimKoCount: 7,
          updatedAt: new Date("2026-06-10T11:45:30.000Z"),
          sourceUpdatedAt: new Date("2026-06-10T11:45:30.000Z"),
        },
      ],
    ]),
  );

  const stored = firestore.get("koObserverViews/guildKoTotals/guildKoTotals/1001001");
  assert.equal(stored.guildId, undefined);
  assert.equal(stored.totalVictimKoCount, 9);
});

test("clears only guildKoTotals for seed mode", async () => {
  const firestore = new FakeFirestore();
  firestore.seed("koObserverRuns/castleKoDetails/castleKoDetails/1", { keep: true });
  firestore.seed("koObserverViews/guildKoTotals/guildKoTotals/1001001", { stale: true });

  const deletedCount = await clearGuildKoTotals(firestore as unknown as Firestore);

  assert.equal(deletedCount, 1);
  assert.equal(firestore.has("koObserverRuns/castleKoDetails/castleKoDetails/1"), true);
  assert.equal(
    firestore.has("koObserverViews/guildKoTotals/guildKoTotals/1001001"),
    false,
  );
});

test("writes seed guild total fields and run meta", async () => {
  const firestore = new FakeFirestore();
  const updatedAt = new Date("2026-06-10T12:00:00.000Z");

  await writeSeedGuildKoTotals(
    firestore as unknown as Firestore,
    new Map([
      [
        "1037001",
        {
          guildName: "Guild A",
          totalVictimKoCount: 12,
          updatedAt,
        },
      ],
    ]),
  );
  await writeKoObserverRunMeta(firestore as unknown as Firestore, updatedAt);

  const stored = firestore.get("koObserverViews/guildKoTotals/guildKoTotals/1037001");
  assert.equal(stored.guildName, "Guild A");
  assert.equal(stored.totalVictimKoCount, 12);
  assert.equal(stored.sourceUpdatedAt, undefined);
  assert.equal(stored.guildId, undefined);
  assert.equal(firestore.has("koObserverRuns/meta"), true);
});

class FakeFirestore {
  private readonly data = new Map<string, Record<string, unknown>>();

  collection(collectionId: string): FakeCollectionReference {
    return new FakeCollectionReference(this, collectionId);
  }

  seed(path: string, value: Record<string, unknown>): void {
    this.data.set(path, value);
  }

  has(path: string): boolean {
    return this.data.has(path);
  }

  get(path: string): Record<string, unknown> {
    const value = this.data.get(path);
    if (!value) {
      throw new Error(`Missing fake Firestore document: ${path}`);
    }
    return value;
  }

  set(path: string, value: Record<string, unknown>): void {
    this.data.set(path, value);
  }

  delete(path: string): void {
    this.data.delete(path);
  }

  listDocumentPaths(collectionPath: string): string[] {
    const prefix = `${collectionPath}/`;
    return [...this.data.keys()].filter((path) => {
      const suffix = path.slice(prefix.length);
      return path.startsWith(prefix) && suffix.length > 0 && !suffix.includes("/");
    });
  }
}

class FakeCollectionReference {
  constructor(
    private readonly firestore: FakeFirestore,
    private readonly path: string,
  ) {}

  doc(documentId: string): FakeDocumentReference {
    return new FakeDocumentReference(this.firestore, `${this.path}/${documentId}`);
  }

  async listDocuments(): Promise<FakeDocumentReference[]> {
    return this.firestore
      .listDocumentPaths(this.path)
      .map((path) => new FakeDocumentReference(this.firestore, path));
  }
}

class FakeDocumentReference {
  constructor(
    private readonly firestore: FakeFirestore,
    private readonly path: string,
  ) {}

  collection(collectionId: string): FakeCollectionReference {
    return new FakeCollectionReference(this.firestore, `${this.path}/${collectionId}`);
  }

  async get(): Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }> {
    const exists = this.firestore.has(this.path);
    return {
      exists,
      data: () => (exists ? this.firestore.get(this.path) : undefined),
    };
  }

  async set(value: Record<string, unknown>): Promise<void> {
    this.firestore.set(this.path, value);
  }

  async delete(): Promise<void> {
    this.firestore.delete(this.path);
  }
}
