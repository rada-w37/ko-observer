import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { createObservationIdentity, ObservationOwnershipError, type ObservationCheckpoint } from "../koo/observationRun.js";
import { SnapshotPublisher } from "./snapshotPublisher.js";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function checkpoint(revision: number): ObservationCheckpoint {
  return { schemaVersion: 2, identity: createObservationIdentity("2026-11-02", "guildBattle", 123),
    accumulator: { revision, castleStates: [] }, guildNames: {}, participantGuilds: {}, updatedAt: new Date("2026-11-02T12:00:00Z") };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

test("keeps an update received during an in-flight save pending until its own commit", async () => {
  const gate = deferred();
  const writes: number[] = [];
  const publisher = new SnapshotPublisher(0, async (snapshot) => {
    writes.push(snapshot.accumulator.revision);
    if (writes.length === 1) await gate.promise;
  }, () => 0, 1000, () => {});
  publisher.offer(checkpoint(1), [1], true);
  publisher.tick();
  await settle();
  publisher.offer(checkpoint(2), [2], false);
  gate.resolve();
  await settle();
  assert.deepEqual(publisher.status, { committedRevision: 1, pending: true });
  publisher.tick();
  await settle();
  assert.deepEqual(writes, [1, 2]);
  assert.deepEqual(publisher.status, { committedRevision: 2, pending: false });
});

test("coalesces pending snapshots while retaining all projection flags and snapshot isolation", async () => {
  const writes: Array<{ revision: number; castleIds: number[]; totals: boolean; time: number }> = [];
  const publisher = new SnapshotPublisher(0, async (snapshot, castleIds, totals) => {
    writes.push({ revision: snapshot.accumulator.revision, castleIds, totals, time: snapshot.updatedAt.getTime() });
  }, () => 0, 1000, () => {});
  const first = checkpoint(1);
  publisher.offer(first, [1], true);
  publisher.offer(checkpoint(2), [2, 1], false);
  const latest = checkpoint(3);
  const expectedTime = latest.updatedAt.getTime();
  publisher.offer(latest, [3], false);
  latest.updatedAt.setTime(0);
  latest.accumulator.revision = 999;
  publisher.tick();
  await settle();
  assert.deepEqual(writes, [{ revision: 3, castleIds: [1, 2, 3], totals: true, time: expectedTime }]);
  publisher.offer(first, [4], true);
  publisher.tick();
  await settle();
  assert.equal(writes.length, 1);
});

test("retry merges a failed save with newer pending data and waits for backoff", async () => {
  let clock = 0;
  const gate = deferred();
  const writes: Array<{ revision: number; castleIds: number[]; totals: boolean }> = [];
  const warnings: string[] = [];
  const publisher = new SnapshotPublisher(0, async (snapshot, castleIds, totals) => {
    writes.push({ revision: snapshot.accumulator.revision, castleIds, totals });
    if (writes.length === 1) await gate.promise;
  }, () => clock, 30_000, (message) => warnings.push(message));
  publisher.offer(checkpoint(1), [1], true);
  publisher.tick();
  await settle();
  publisher.offer(checkpoint(2), [2], false);
  gate.reject(Object.assign(new Error("temporarily unavailable"), { code: 14 }));
  await settle();
  publisher.tick();
  assert.equal(writes.length, 1);
  assert.equal(warnings.length, 1);
  clock = 1000;
  publisher.tick();
  await settle();
  assert.deepEqual(writes[1], { revision: 2, castleIds: [2, 1], totals: true });
  assert.deepEqual(publisher.status, { committedRevision: 2, pending: false });
});

test("a timed-out unsettled save cannot start an overlapping attempt or acknowledge later data", async () => {
  let clock = 0;
  const gate = deferred();
  let attempts = 0;
  const publisher = new SnapshotPublisher(0, async () => { attempts++; await gate.promise; }, () => clock, 30, () => {});
  publisher.offer(checkpoint(1), [1], true);
  publisher.tick();
  await settle();
  publisher.offer(checkpoint(2), [2], false);
  clock = 30;
  assert.throws(() => publisher.tick(), /timed out/);
  assert.throws(() => publisher.tick(), /timed out/);
  assert.equal(attempts, 1);
  assert.equal(publisher.status.committedRevision, 0);
  publisher.close();
  gate.resolve();
  await settle();
  assert.equal(attempts, 1);
  assert.equal(publisher.status.committedRevision, 1);
  assert.throws(() => publisher.offer(checkpoint(3), [], false), /closed/);
});

for (const failure of [new ObservationOwnershipError("ownership changed"), Object.assign(new Error("permission denied"), { code: 7 }), new Error("invalid checkpoint")]) {
  test(`does not retry permanent failure: ${failure.message}`, async () => {
    let attempts = 0;
    const publisher = new SnapshotPublisher(0, async () => { attempts++; throw failure; }, () => 0, 1000, () => {});
    publisher.offer(checkpoint(1), [1], true);
    publisher.tick();
    await settle();
    assert.throws(() => publisher.tick(), (error) => error === failure);
    await assert.rejects(publisher.flush(100), (error) => error === failure);
    assert.equal(attempts, 1);
  });
}

test("flush publishes the latest pending snapshot and returns only after commit", async () => {
  const writes: number[] = [];
  const publisher = new SnapshotPublisher(0, async (snapshot) => { writes.push(snapshot.accumulator.revision); }, () => performance.now(), 1000, () => {});
  publisher.offer(checkpoint(1), [1], true);
  publisher.offer(checkpoint(2), [2], false);
  await publisher.flush(1000);
  assert.deepEqual(writes, [2]);
  assert.deepEqual(publisher.status, { committedRevision: 2, pending: false });
});

test("flush has a bounded wait for an unresolved commit", async () => {
  const publisher = new SnapshotPublisher(0, async () => new Promise(() => {}), () => performance.now(), 1000, () => {});
  publisher.offer(checkpoint(1), [], false);
  await assert.rejects(publisher.flush(20), /final save timed out/);
  publisher.close();
});
