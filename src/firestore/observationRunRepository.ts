import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Timestamp, type Firestore, type Transaction, type DocumentReference, type DocumentSnapshot } from "firebase-admin/firestore";
import { calculateGuildKoTotals, createKoCastlePublicSnapshot } from "../koo/koAttribution.js";
import { getJstDateString } from "../app/date.js";
import { ObservationOwnershipError, type ObservationLease, type ObservationIdentity, type ObservationCheckpoint, type ObservationRunStore } from "../koo/observationRun.js";
import { encodeObservationCheckpoint, decodeObservationCheckpoint } from "./observationCheckpointCodec.js";

export const OBSERVATION_LEASE_MS = 60_000;

export class ObservationRunRepository implements ObservationRunStore {
  private readonly ownerId = randomUUID();
  private readonly runtime;
  private readonly checkpoint;
  private readonly meta;
  private readonly castles;
  private readonly totals;

  constructor(private readonly firestore: Firestore, private readonly monotonicNow = () => performance.now()) {
    this.runtime = firestore.doc("koObserverRuns/runtime");
    this.checkpoint = firestore.doc("koObserverRuns/checkpoint");
    this.meta = firestore.doc("koObserverRuns/meta");
    this.castles = firestore.collection("koObserverRuns/castleKoDetails/castleKoDetails");
    this.totals = firestore.collection("koObserverViews/guildKoTotals/guildKoTotals");
  }

  async acquire(): Promise<ObservationLease> {
    const requestStarted = this.monotonicNow();
    return this.firestore.runTransaction(async (transaction) => {
      const runtime = await transaction.get(this.runtime);
      const current = runtime.data();
      if (current?.ownerId && current.expiresAt.toMillis() > runtime.readTime.toMillis()) {
        throw new ObservationOwnershipError("Another observation or seed run is already active.");
      }
      const fenceToken = (current?.fenceToken ?? 0) + 1;
      transaction.set(this.runtime, {
        ownerId: this.ownerId, fenceToken,
        expiresAt: Timestamp.fromMillis(runtime.readTime.toMillis() + OBSERVATION_LEASE_MS),
      }, { merge: true });
      return { ownerId: this.ownerId, fenceToken, validUntil: requestStarted + OBSERVATION_LEASE_MS };
    });
  }

  async renew(lease: ObservationLease): Promise<ObservationLease> {
    const requestStarted = this.monotonicNow();
    await this.firestore.runTransaction(async (transaction) => {
      const runtime = await this.checkOwner(transaction, lease);
      transaction.update(this.runtime, { expiresAt: Timestamp.fromMillis(runtime.readTime.toMillis() + OBSERVATION_LEASE_MS) });
    });
    return { ...lease, validUntil: requestStarted + OBSERVATION_LEASE_MS };
  }

  async resume(lease: ObservationLease, identity: ObservationIdentity, participants: Record<string, string>, startedAt: Date) {
    return this.firestore.runTransaction(async (transaction) => {
      await this.checkOwner(transaction, lease);
      const [stored, meta, oldCastles, oldTotals] = await Promise.all([
        transaction.get(this.checkpoint), transaction.get(this.meta),
        transaction.get(this.castles), transaction.get(this.totals),
      ]);
      const previous = stored.exists ? decodeObservationCheckpoint(stored.data()) : undefined;
      const resumed = previous?.identity.sessionId === identity.sessionId;
      const legacyStarted = meta.data()?.lastStartedAt;
      if (!previous && legacyStarted instanceof Timestamp && getJstDateString(legacyStarted.toDate()) === identity.battleDate) {
        throw new Error("Legacy data exists for this battle date; switch at the next battle. Existing data preserved.");
      }
      const checkpoint: ObservationCheckpoint = resumed ? previous! : {
        schemaVersion: 1, identity, accumulator: { revision: 0, castleStates: [] },
        guildNames: { ...participants }, participantGuilds: { ...participants }, updatedAt: startedAt,
      };
      for (const document of [...oldCastles.docs, ...oldTotals.docs]) transaction.delete(document.ref);
      transaction.set(this.checkpoint, encodeObservationCheckpoint(checkpoint));
      this.writeProjection(transaction, checkpoint);
      transaction.set(this.meta, { lastStartedAt: Timestamp.fromDate(startedAt) });
      transaction.update(this.runtime, { activeSessionId: identity.sessionId, publishedSessionId: identity.sessionId });
      return { checkpoint, resumed };
    });
  }

  async commit(lease: ObservationLease, checkpoint: ObservationCheckpoint, castleIds: number[], publishTotals: boolean): Promise<void> {
    const encoded = encodeObservationCheckpoint(checkpoint);
    const snapshot = decodeObservationCheckpoint(encoded);
    const selectedCastles = new Set(castleIds);
    await this.firestore.runTransaction(async (transaction) => {
      await this.checkOwner(transaction, lease);
      const stored = await transaction.get(this.checkpoint);
      if (!stored.exists) throw new Error("Observation checkpoint is missing.");
      const current = decodeObservationCheckpoint(stored.data());
      if (current.identity.sessionId !== snapshot.identity.sessionId) throw new ObservationOwnershipError("Observation session changed.");
      if (snapshot.accumulator.revision <= current.accumulator.revision) return;
      transaction.set(this.checkpoint, encoded);
      this.writeProjection(transaction, snapshot, selectedCastles, publishTotals);
    });
  }

  async release(lease: ObservationLease): Promise<void> {
    await this.firestore.runTransaction(async (transaction) => {
      await this.checkOwner(transaction, lease);
      transaction.update(this.runtime, { ownerId: null, expiresAt: Timestamp.fromMillis(0) });
    });
  }

  async seed(lease: ObservationLease, totals: Map<string, { guildName: string; totalVictimKoCount: number; updatedAt: Date }>, clear: boolean, updatedAt = new Date()): Promise<number> {
    return this.firestore.runTransaction(async (transaction) => {
      await this.checkOwner(transaction, lease);
      const previous = await transaction.get(this.totals);
      if (clear) previous.docs.forEach((document) => transaction.delete(document.ref));
      for (const [guildId, total] of totals) transaction.set(this.totals.doc(guildId), { ...total, updatedAt: Timestamp.fromDate(total.updatedAt) });
      transaction.update(this.runtime, { publishedSessionId: "seed" });
      transaction.set(this.meta, { lastStartedAt: Timestamp.fromDate(updatedAt) });
      return clear ? previous.size : 0;
    });
  }

  private async checkOwner(transaction: Transaction, lease: ObservationLease): Promise<DocumentSnapshot> {
    const runtime = await transaction.get(this.runtime);
    const current = runtime.data();
    if (current?.ownerId !== lease.ownerId || current?.fenceToken !== lease.fenceToken ||
        !(current.expiresAt instanceof Timestamp) || current.expiresAt.toMillis() <= runtime.readTime.toMillis() || this.monotonicNow() >= lease.validUntil) {
      throw new ObservationOwnershipError("Observation ownership expired or changed.");
    }
    return runtime;
  }

  private writeProjection(transaction: Transaction, checkpoint: ObservationCheckpoint, castleIds?: Set<number>, publishTotals = true): void {
    for (const state of checkpoint.accumulator.castleStates) {
      if (castleIds && !castleIds.has(state.castleId)) continue;
      transaction.set(this.castles.doc(String(state.castleId)), this.publicCastle(state));
    }
    if (!publishTotals) return;
    const totals = calculateGuildKoTotals(checkpoint.accumulator.castleStates);
    for (const [guildId, guildName] of Object.entries(checkpoint.participantGuilds)) {
      if (!totals.has(guildId)) totals.set(guildId, { guildName, totalVictimKoCount: 0, sourceUpdatedAt: checkpoint.updatedAt });
    }
    for (const [guildId, total] of totals) transaction.set(this.totals.doc(guildId), {
      ...total, updatedAt: Timestamp.fromDate(checkpoint.updatedAt), sourceUpdatedAt: Timestamp.fromDate(total.sourceUpdatedAt),
    });
  }

  private publicCastle(state: ObservationCheckpoint["accumulator"]["castleStates"][number]): Record<string, unknown> {
    const snapshot = createKoCastlePublicSnapshot(state);
    return { ...snapshot, updatedAt: Timestamp.fromDate(snapshot.updatedAt), lastObservedAt: Timestamp.fromDate(snapshot.lastObservedAt),
      defender: { ...snapshot.defender, updatedAt: Timestamp.fromDate(snapshot.defender.updatedAt) },
      attacker: { ...snapshot.attacker, updatedAt: Timestamp.fromDate(snapshot.attacker.updatedAt) } };
  }
}
