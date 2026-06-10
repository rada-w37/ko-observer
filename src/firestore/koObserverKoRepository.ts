import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { KoCastlePublicSnapshot } from "../koo/koAttribution.js";

const KO_OBSERVER_RUNS_COLLECTION = "koObserverRuns";
const KO_OBSERVER_VIEWS_COLLECTION = "koObserverViews";
const CASTLE_KO_DETAILS_DOCUMENT_ID = "castleKoDetails";
const GUILD_KO_TOTALS_DOCUMENT_ID = "guildKoTotals";
const META_DOCUMENT_ID = "meta";

type WriteGuildKoTotalInput = {
  guildName: string | null;
  totalVictimKoCount: number;
  updatedAt: Date;
  sourceUpdatedAt: Date;
};

type ExistingCastleKoDetail = {
  defender?: {
    koVictimCount?: number;
  };
  attacker?: {
    koVictimCount?: number;
  };
};

type ExistingGuildKoTotal = {
  totalVictimKoCount?: number;
};

export async function initializePhase5KoObserverRun(
  firestore: Firestore,
  startedAt: Date,
): Promise<{
  deletedCastleKoDetailsCount: number;
  deletedGuildKoTotalsCount: number;
}> {
  const [deletedCastleKoDetailsCount, deletedGuildKoTotalsCount] = await Promise.all([
    deleteSubcollection(firestore, KO_OBSERVER_RUNS_COLLECTION, CASTLE_KO_DETAILS_DOCUMENT_ID),
    deleteSubcollection(firestore, KO_OBSERVER_VIEWS_COLLECTION, GUILD_KO_TOTALS_DOCUMENT_ID),
  ]);

  await firestore.collection(KO_OBSERVER_RUNS_COLLECTION).doc(META_DOCUMENT_ID).set({
    lastStartedAt: Timestamp.fromDate(startedAt),
  });

  return {
    deletedCastleKoDetailsCount,
    deletedGuildKoTotalsCount,
  };
}

export async function writeCastleKoDetail(
  firestore: Firestore,
  snapshot: KoCastlePublicSnapshot,
): Promise<void> {
  const documentReference = firestore
    .collection(KO_OBSERVER_RUNS_COLLECTION)
    .doc(CASTLE_KO_DETAILS_DOCUMENT_ID)
    .collection(CASTLE_KO_DETAILS_DOCUMENT_ID)
    .doc(snapshot.castleId.toString());
  const existingSnapshot = await documentReference.get();
  const existingData = existingSnapshot.exists
    ? (existingSnapshot.data() as ExistingCastleKoDetail)
    : undefined;

  await documentReference.set({
    castleId: snapshot.castleId,
    updatedAt: Timestamp.fromDate(snapshot.updatedAt),
    lastObservedAt: Timestamp.fromDate(snapshot.lastObservedAt),
    defender: {
      guildId: snapshot.defender.guildId,
      guildName: snapshot.defender.guildName,
      koVictimCount: Math.max(
        snapshot.defender.koVictimCount,
        existingData?.defender?.koVictimCount ?? 0,
      ),
      lastCheckpointSlot: snapshot.defender.lastCheckpointSlot,
      updatedAt: Timestamp.fromDate(snapshot.defender.updatedAt),
    },
    attacker: {
      guildId: snapshot.attacker.guildId,
      guildName: snapshot.attacker.guildName,
      koVictimCount: Math.max(
        snapshot.attacker.koVictimCount,
        existingData?.attacker?.koVictimCount ?? 0,
      ),
      lastCheckpointSlot: snapshot.attacker.lastCheckpointSlot,
      updatedAt: Timestamp.fromDate(snapshot.attacker.updatedAt),
    },
  });
}

export async function writeGuildKoTotals(
  firestore: Firestore,
  guildKoTotals: Map<string, WriteGuildKoTotalInput>,
): Promise<void> {
  await Promise.all(
    [...guildKoTotals].map(async ([guildId, input]) => {
      const documentReference = firestore
        .collection(KO_OBSERVER_VIEWS_COLLECTION)
        .doc(GUILD_KO_TOTALS_DOCUMENT_ID)
        .collection(GUILD_KO_TOTALS_DOCUMENT_ID)
        .doc(guildId);
      const existingSnapshot = await documentReference.get();
      const existingData = existingSnapshot.exists
        ? (existingSnapshot.data() as ExistingGuildKoTotal)
        : undefined;

      await documentReference.set({
        guildName: input.guildName,
        totalVictimKoCount: Math.max(
          input.totalVictimKoCount,
          existingData?.totalVictimKoCount ?? 0,
        ),
        updatedAt: Timestamp.fromDate(input.updatedAt),
        sourceUpdatedAt: Timestamp.fromDate(input.sourceUpdatedAt),
      });
    }),
  );
}

async function deleteSubcollection(
  firestore: Firestore,
  parentCollectionId: string,
  parentDocumentId: string,
): Promise<number> {
  const documents = await firestore
    .collection(parentCollectionId)
    .doc(parentDocumentId)
    .collection(parentDocumentId)
    .listDocuments();

  await Promise.all(documents.map((documentReference) => documentReference.delete()));
  return documents.length;
}
