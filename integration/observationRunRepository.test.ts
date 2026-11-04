import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { Firestore, Timestamp } from "firebase-admin/firestore";
import { ObservationRunRepository } from "../src/firestore/observationRunRepository.js";
import { decodeObservationCheckpoint, encodeObservationCheckpoint } from "../src/firestore/observationCheckpointCodec.js";
import { KoAccumulator } from "../src/koo/koAccumulator.js";
import { createObservationIdentity, ObservationOwnershipError, type ObservationCheckpoint } from "../src/koo/observationRun.js";
import { buildGvgStreamId } from "../src/mentemori/streamId.js";

const PROJECT = "demo-ko-observer";
const HOST = "127.0.0.1:8080";
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, HOST, "Repository integration tests only allow the local Firestore Emulator.");
const firestore = new Firestore({ projectId: PROJECT, host: HOST, ssl: false });
const runtime = firestore.doc("koObserverRuns/runtime");
const checkpointRef = firestore.doc("koObserverRuns/checkpoint");
const meta = firestore.doc("koObserverRuns/meta");
const castle = (castleId: number) => firestore.doc(`koObserverRuns/castleKoDetails/castleKoDetails/${castleId}`);
const total = (guildId: string) => firestore.doc(`koObserverViews/guildKoTotals/guildKoTotals/${guildId}`);
const DEFENDER = "111111111037";
const ATTACKER = "222222222037";
const STARTED_AT = new Date("2026-11-02T11:45:01Z");
const identity = (battleDate = "2026-11-02") => createObservationIdentity(battleDate, "guildBattle", buildGvgStreamId({
  castleId: 0, block: 0, worldGroupId: 0, gvgClass: 0, worldId: 1037,
}));

beforeEach(async () => {
  const response = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: "DELETE", signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
});
after(async () => { await firestore.terminate(); });

function checkpoint(victimTotal: number, revision = 2): ObservationCheckpoint {
  const accumulator = new KoAccumulator();
  const observation = {
    castleId: 1, defenderGuildId: DEFENDER, defenderGuildName: "Defender",
    attackerGuildId: ATTACKER, attackerGuildName: "Attacker",
    defensePartyCount: 100, attackPartyCount: 100, koCount: 0, observedAt: STARTED_AT,
  };
  accumulator.observe(observation);
  const snapshot = accumulator.exportSnapshot();
  snapshot.castleStates[0].defenseVictimKoTotal = victimTotal;
  snapshot.castleStates[0].guildVictimKoTotals[DEFENDER] = { guildName: "Defender", totalVictimKoCount: victimTotal };
  return {
    schemaVersion: 2, identity: identity(), accumulator: { ...snapshot, revision },
    guildNames: { [DEFENDER]: "Defender", [ATTACKER]: "Attacker" }, participantGuilds: {},
    updatedAt: new Date("2026-11-02T11:45:05Z"),
  };
}

async function publicTotals(): Promise<Record<string, number>> {
  const snapshot = await firestore.collection("koObserverViews/guildKoTotals/guildKoTotals").get();
  return Object.fromEntries(snapshot.docs.map((document) => [document.id, document.data().totalVictimKoCount]));
}

test("v1 is preserved in the same battle and replaced only on the next battle", async () => {
  const legacy = encodeObservationCheckpoint(checkpoint(7)) as any;
  legacy.schemaVersion = 1;
  for (const state of legacy.accumulator.castleStates) {
    delete state.candidates;
    delete state.closedUnresolvedKo;
    delete state.modelMismatchCount;
    Object.assign(state, { attributionMode: "defenseVictim", suspiciousSwitch: false,
      hasKoChangeSinceLastCheckpoint: false, unknownVictimKo: 0, pendingDefenseVictimKo: 0,
      pendingAttackVictimKo: 0, pendingUnknownInitialKo: 0 });
  }
  await checkpointRef.set(legacy);
  await total(DEFENDER).set({ totalVictimKoCount: 7 });
  const repository = new ObservationRunRepository(firestore);
  const lease = await repository.acquire();
  await assert.rejects(repository.resume(lease, identity(), {}, STARTED_AT), /next battle/);
  assert.deepEqual((await checkpointRef.get()).data(), legacy);
  assert.deepEqual(await publicTotals(), { [DEFENDER]: 7 });
  const next = await repository.resume(lease, identity("2026-11-03"), {}, new Date("2026-11-03T11:45:01Z"));
  assert.equal(next.checkpoint.schemaVersion, 2);
  assert.equal(next.checkpoint.accumulator.revision, 0);
  assert.deepEqual(await publicTotals(), {});
});

test("only the first of two concurrent owners can acquire the active lease", async () => {
  const repositories = [new ObservationRunRepository(firestore), new ObservationRunRepository(firestore)];
  const results = await Promise.allSettled(repositories.map((repository) => repository.acquire()));
  const successes = results.filter((result) => result.status === "fulfilled");
  const failures = results.filter((result) => result.status === "rejected");
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.ok(failures[0].status === "rejected" && failures[0].reason instanceof ObservationOwnershipError);
  assert.equal((await runtime.get()).data()?.fenceToken, 1);
  assert.equal((await checkpointRef.get()).exists, false);
  assert.deepEqual(await publicTotals(), {});
});

test("lease renewal extends the conservative local deadline and rejects local expiry", async () => {
  let monotonic = 1000;
  const repository = new ObservationRunRepository(firestore, () => monotonic);
  const lease = await repository.acquire();
  assert.equal(lease.validUntil, 61_000);
  monotonic = 2000;
  const renewed = await repository.renew(lease);
  assert.equal(renewed.validUntil, 62_000);
  const stored = await runtime.get();
  assert.ok(stored.data()?.expiresAt instanceof Timestamp);
  assert.ok(stored.data()!.expiresAt.toMillis() > stored.readTime.toMillis());
  monotonic = 62_000;
  await assert.rejects(repository.renew(renewed), ObservationOwnershipError);
});

test("a new owner fences expired owners out of renew, commit, seed, resume and release", async () => {
  const oldRepository = new ObservationRunRepository(firestore);
  const oldLease = await oldRepository.acquire();
  await oldRepository.resume(oldLease, identity(), {}, STARTED_AT);
  await oldRepository.commit(oldLease, checkpoint(7), [1], true);
  await runtime.update({ expiresAt: Timestamp.fromMillis(0) });
  const newRepository = new ObservationRunRepository(firestore);
  const newLease = await newRepository.acquire();
  assert.equal(newLease.fenceToken, oldLease.fenceToken + 1);
  const resumed = await newRepository.resume(newLease, identity(), {}, STARTED_AT);
  assert.equal(resumed.resumed, true);
  await newRepository.commit(newLease, checkpoint(9, 4), [1], true);
  for (const action of [
    () => oldRepository.renew(oldLease),
    () => oldRepository.commit(oldLease, checkpoint(99, 99), [1], true),
    () => oldRepository.seed(oldLease, new Map(), true),
    () => oldRepository.resume(oldLease, identity(), {}, STARTED_AT),
    () => oldRepository.release(oldLease),
  ]) await assert.rejects(action(), ObservationOwnershipError);
  assert.equal((await runtime.get()).data()?.ownerId, newLease.ownerId);
  assert.equal((await total(DEFENDER).get()).data()?.totalVictimKoCount, 9);
  assert.equal(decodeObservationCheckpoint((await checkpointRef.get()).data()).accumulator.revision, 4);
});

test("lower and duplicate revisions cannot replace a newer committed snapshot", async () => {
  const repository = new ObservationRunRepository(firestore);
  const lease = await repository.acquire();
  await repository.resume(lease, identity(), {}, STARTED_AT);
  await repository.commit(lease, checkpoint(2), [1], true);
  await repository.commit(lease, checkpoint(9, 5), [1], true);
  await repository.commit(lease, checkpoint(3, 4), [1], true);
  await repository.commit(lease, checkpoint(88, 5), [1], true);
  assert.equal((await total(DEFENDER).get()).data()?.totalVictimKoCount, 9);
  assert.equal((await castle(1).get()).data()?.defender.koVictimCount, 9);
  assert.deepEqual(decodeObservationCheckpoint((await checkpointRef.get()).data()), checkpoint(9, 5));
});

test("concurrent commits from one owner converge to the greatest revision", async () => {
  const repository = new ObservationRunRepository(firestore);
  const lease = await repository.acquire();
  await repository.resume(lease, identity(), {}, STARTED_AT);
  await Promise.all([
    repository.commit(lease, checkpoint(7, 4), [1], true),
    repository.commit(lease, checkpoint(11, 8), [1], true),
  ]);
  assert.equal((await total(DEFENDER).get()).data()?.totalVictimKoCount, 11);
  assert.equal(decodeObservationCheckpoint((await checkpointRef.get()).data()).accumulator.revision, 8);
});

test("same-revision resume reconstructs every public view and removes surplus seed documents", async () => {
  const repository = new ObservationRunRepository(firestore);
  const lease = await repository.acquire();
  await repository.resume(lease, identity(), {}, STARTED_AT);
  await repository.commit(lease, checkpoint(7), [1], true);
  await repository.seed(lease, new Map([
    [DEFENDER, { guildName: "Dummy defender", totalVictimKoCount: 999, updatedAt: STARTED_AT }],
    ["999999999037", { guildName: "Extra dummy", totalVictimKoCount: 88, updatedAt: STARTED_AT }],
  ]), true);
  await castle(21).set({ castleId: 21, stale: true });
  assert.equal((await runtime.get()).data()?.publishedSessionId, "seed");
  await repository.release(lease);
  const restarted = new ObservationRunRepository(firestore);
  const restartedLease = await restarted.acquire();
  const result = await restarted.resume(restartedLease, identity(), {}, new Date("2026-11-02T12:00:00Z"));
  assert.equal(result.resumed, true);
  assert.deepEqual(result.checkpoint, checkpoint(7));
  assert.deepEqual(await publicTotals(), { [DEFENDER]: 7 });
  assert.equal((await castle(21).get()).exists, false);
  assert.equal((await castle(1).get()).data()?.defender.koVictimCount, 7);
  assert.equal((await runtime.get()).data()?.publishedSessionId, identity().sessionId);
  const publicRecord = (await total(DEFENDER).get()).data()!;
  assert.equal("guildId" in publicRecord, false);
  assert.equal("revision" in publicRecord, false);
  assert.equal("schemaVersion" in publicRecord, false);
});

test("same-day legacy data is rejected and preserved without creating a checkpoint", async () => {
  await meta.set({ lastStartedAt: Timestamp.fromDate(STARTED_AT) });
  await total(DEFENDER).set({ guildName: "Legacy", totalVictimKoCount: 41 });
  await castle(1).set({ castleId: 1, legacy: true });
  const repository = new ObservationRunRepository(firestore);
  const lease = await repository.acquire();
  await assert.rejects(repository.resume(lease, identity(), {}, STARTED_AT), /Legacy data exists/);
  assert.equal((await checkpointRef.get()).exists, false);
  assert.deepEqual((await total(DEFENDER).get()).data(), { guildName: "Legacy", totalVictimKoCount: 41 });
  assert.deepEqual((await castle(1).get()).data(), { castleId: 1, legacy: true });
  assert.deepEqual((await meta.get()).data(), { lastStartedAt: Timestamp.fromDate(STARTED_AT) });
});

test("corrupt or unsupported checkpoints never delete or rebuild existing public data", async () => {
  const encoded = encodeObservationCheckpoint(checkpoint(7)) as unknown as ObservationCheckpoint;
  encoded.accumulator.castleStates[0].candidates = [{ side: "defense", min: [0, 0, 0], max: [0, 5, 3] }];
  await total(DEFENDER).set({ guildName: "Existing", totalVictimKoCount: 41 });
  await castle(1).set({ castleId: 1, existing: true });
  const repository = new ObservationRunRepository(firestore);
  const lease = await repository.acquire();
  for (const corrupt of [encoded, { ...encodeObservationCheckpoint(checkpoint(7)), schemaVersion: 99 }]) {
    await checkpointRef.set(corrupt);
    await assert.rejects(repository.resume(lease, identity(), {}, STARTED_AT), /unsupported or corrupt/i);
    assert.deepEqual((await checkpointRef.get()).data(), corrupt);
    assert.deepEqual((await total(DEFENDER).get()).data(), { guildName: "Existing", totalVictimKoCount: 41 });
    assert.deepEqual((await castle(1).get()).data(), { castleId: 1, existing: true });
    assert.equal((await meta.get()).exists, false);
  }
});

test("failed new-day initialization is atomic and a successful new day resets only the published dataset", async () => {
  const yesterday = new Date("2026-11-01T11:45:00Z");
  await meta.set({ lastStartedAt: Timestamp.fromDate(yesterday) });
  await total("888888888037").set({ guildName: "Yesterday", totalVictimKoCount: 50 });
  await castle(2).set({ castleId: 2, yesterday: true });
  const repository = new ObservationRunRepository(firestore);
  const lease = await repository.acquire();
  const corruptParticipants = { [DEFENDER]: undefined } as unknown as Record<string, string>;
  await assert.rejects(repository.resume(lease, identity(), corruptParticipants, STARTED_AT), /unsupported or corrupt/i);
  assert.equal((await checkpointRef.get()).exists, false);
  assert.deepEqual(await publicTotals(), { "888888888037": 50 });
  assert.equal((await castle(2).get()).data()?.yesterday, true);
  assert.deepEqual((await meta.get()).data(), { lastStartedAt: Timestamp.fromDate(yesterday) });
  const result = await repository.resume(lease, identity(), { [DEFENDER]: "Defender", [ATTACKER]: "Attacker" }, STARTED_AT);
  assert.equal(result.resumed, false);
  assert.equal(result.checkpoint.accumulator.revision, 0);
  assert.deepEqual(result.checkpoint.accumulator.castleStates, []);
  assert.deepEqual(await publicTotals(), { [DEFENDER]: 0, [ATTACKER]: 0 });
  assert.equal((await castle(2).get()).exists, false);
  assert.equal((await runtime.get()).data()?.activeSessionId, identity().sessionId);
  assert.deepEqual((await meta.get()).data(), { lastStartedAt: Timestamp.fromDate(STARTED_AT) });
});

test("checkpoint progress and publication flags stay independent, and resume repairs the full projection", async () => {
  const repository = new ObservationRunRepository(firestore);
  const lease = await repository.acquire();
  await repository.resume(lease, identity(), {}, STARTED_AT);
  await repository.commit(lease, checkpoint(7), [1], true);
  await repository.commit(lease, checkpoint(8, 3), [], false);
  assert.equal(decodeObservationCheckpoint((await checkpointRef.get()).data()).accumulator.revision, 3);
  assert.deepEqual(await publicTotals(), { [DEFENDER]: 7 });
  assert.equal((await castle(1).get()).data()?.defender.koVictimCount, 7);
  const result = await repository.resume(lease, identity(), {}, STARTED_AT);
  assert.equal(result.resumed, true);
  assert.deepEqual(await publicTotals(), { [DEFENDER]: 8 });
  assert.equal((await castle(1).get()).data()?.defender.koVictimCount, 8);
});

test("mutating a caller snapshot during commit cannot split its checkpoint and public totals", async () => {
  const repository = new ObservationRunRepository(firestore);
  const lease = await repository.acquire();
  await repository.resume(lease, identity(), {}, STARTED_AT);
  const pendingCheckpoint = checkpoint(7);
  const pending = repository.commit(lease, pendingCheckpoint, [1], true);
  pendingCheckpoint.accumulator.castleStates[0].defenseVictimKoTotal = 99;
  pendingCheckpoint.accumulator.castleStates[0].guildVictimKoTotals[DEFENDER].totalVictimKoCount = 99;
  await pending;
  const committed = decodeObservationCheckpoint((await checkpointRef.get()).data());
  assert.equal(committed.accumulator.castleStates[0].defenseVictimKoTotal, 7);
  assert.deepEqual(await publicTotals(), { [DEFENDER]: 7 });
  assert.equal((await castle(1).get()).data()?.defender.koVictimCount, 7);
});

test("unknown legacy date and corrupt runtime never trigger data initialization", async () => {
  await total(DEFENDER).set({ totalVictimKoCount: 42 });
  const repository = new ObservationRunRepository(firestore);
  const lease = await repository.acquire();
  await assert.rejects(repository.resume(lease, identity(), {}, STARTED_AT), /no valid battle date/);
  await meta.set({ lastStartedAt: "invalid" });
  await assert.rejects(repository.resume(lease, identity(), {}, STARTED_AT), /no valid battle date/);
  assert.deepEqual(await publicTotals(), { [DEFENDER]: 42 });
  await repository.release(lease);
  await runtime.update({ fenceToken: "invalid" });
  await assert.rejects(new ObservationRunRepository(firestore).acquire(), /Corrupt observation runtime/);
  assert.deepEqual(await publicTotals(), { [DEFENDER]: 42 });
});
