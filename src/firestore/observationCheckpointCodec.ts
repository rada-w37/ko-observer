import { Timestamp } from "firebase-admin/firestore";
import { createObservationIdentity, type ObservationCheckpoint, type ObservationIdentity } from "../koo/observationRun.js";

const nullableDates = ["lastObservedAt", "lastUpdatedAt"];
const nullableCounts = ["lastKoCount", "lastDefensePartyCount", "lastAttackPartyCount", "lastCheckpointSlot"];
const counts = ["defenseVictimKoTotal", "attackVictimKoTotal"];
const legacyCounts = ["unknownVictimKo", "pendingDefenseVictimKo", "pendingAttackVictimKo", "pendingUnknownInitialKo"];
const nullableNames = ["defenderGuildId", "defenderGuildName", "attackerGuildId", "attackerGuildName"];

export function encodeObservationCheckpoint(checkpoint: ObservationCheckpoint): Record<string, unknown> {
  validate(checkpoint);
  if (checkpoint.schemaVersion !== 2) throw new Error("Only checkpoint v2 can be written.");
  return transform(checkpoint, true) as Record<string, unknown>;
}

export function decodeObservationCheckpoint(stored: unknown): ObservationCheckpoint {
  const checkpoint = decodeStoredObservationCheckpoint(stored);
  if (checkpoint.schemaVersion !== 2) invalid();
  return checkpoint;
}

export function decodeStoredObservationCheckpoint(stored: unknown): ObservationCheckpoint | { schemaVersion: 1; identity: ObservationIdentity } {
  const checkpoint = transform(stored, false);
  validate(checkpoint);
  if (checkpoint.schemaVersion === 1) return { schemaVersion: 1, identity: checkpoint.identity };
  return checkpoint as ObservationCheckpoint;
}

function transform(input: unknown, encode: boolean): unknown {
  if (input instanceof Date) return encode ? Timestamp.fromDate(input) : new Date(input);
  if (input instanceof Timestamp) return encode ? input : input.toDate();
  if (Array.isArray(input)) return input.map((entry) => transform(entry, encode));
  if (input !== null && typeof input === "object") {
    return Object.fromEntries(Object.entries(input).map(([key, entry]) => [key, transform(entry, encode)]));
  }
  return input;
}

function record(input: unknown): input is Record<string, any> {
  return input !== null && typeof input === "object" && !Array.isArray(input) && !(input instanceof Date);
}

function count(input: unknown): boolean {
  return Number.isSafeInteger(input) && (input as number) >= 0;
}

function date(input: unknown): boolean {
  return input instanceof Date && Number.isFinite(input.getTime());
}

function validate(input: unknown): asserts input is Record<string, any> {
  if (!record(input) || ![1, 2].includes(input.schemaVersion) || !record(input.identity) || !record(input.accumulator)) invalid();
  const identity = input.identity;
  if (typeof identity.battleDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(identity.battleDate) ||
      !Number.isFinite(Date.parse(`${identity.battleDate}T00:00:00Z`)) ||
      new Date(`${identity.battleDate}T00:00:00Z`).toISOString().slice(0, 10) !== identity.battleDate ||
      !["guildBattle", "grandBattle"].includes(identity.battleType) ||
      !count(identity.streamId) || identity.streamId > 0xffffffff ||
      createObservationIdentity(identity.battleDate, identity.battleType, identity.streamId).sessionId !== identity.sessionId) invalid();
  if (!count(input.accumulator.revision) || !Array.isArray(input.accumulator.castleStates) || !date(input.updatedAt)) invalid();
  for (const names of [input.guildNames, input.participantGuilds]) {
    if (!record(names) || Object.values(names).some((name) => typeof name !== "string")) invalid();
  }
  const castleIds = new Set<number>();
  for (const state of input.accumulator.castleStates) {
    if (!record(state) || !count(state.castleId) || state.castleId < 1 || state.castleId > 21 || castleIds.has(state.castleId)) invalid();
    castleIds.add(state.castleId);
    if (counts.some((key) => !count(state[key])) || nullableCounts.some((key) => state[key] !== null && !count(state[key]))) invalid();
    if (nullableDates.some((key) => state[key] !== null && !date(state[key]))) invalid();
    if (nullableNames.some((key) => state[key] !== null && typeof state[key] !== "string")) invalid();
    if (!record(state.guildVictimKoTotals)) invalid();
    if (input.schemaVersion === 1 && (legacyCounts.some((key) => !count(state[key])) ||
        !["unknown", "defenseVictim", "attackVictim"].includes(state.attributionMode) ||
        typeof state.suspiciousSwitch !== "boolean" || typeof state.hasKoChangeSinceLastCheckpoint !== "boolean")) invalid();
    if (input.schemaVersion === 2) {
      if (!Array.isArray(state.candidates) || state.candidates.length < 1 || state.candidates.length > 2 ||
          new Set(state.candidates.map((c: any) => c?.side)).size !== state.candidates.length ||
          !Array.isArray(state.closedUnresolvedKo) || state.closedUnresolvedKo.length !== 2 ||
          !state.closedUnresolvedKo.every(count) || state.closedUnresolvedKo[0] > state.closedUnresolvedKo[1] || !count(state.modelMismatchCount)) invalid();
      for (const candidate of state.candidates) {
        if (!record(candidate) || !["defense", "attack"].includes(candidate.side) ||
            !Array.isArray(candidate.min) || !Array.isArray(candidate.max) || candidate.min.length !== 3 || candidate.max.length !== 3 ||
            !candidate.min.every(count) || !candidate.max.every(count) || candidate.min.some((n: number, i: number) => n > candidate.max[i])) invalid();
        const [defenseMin, attackMin, totalMin] = candidate.min;
        const [defenseMax, attackMax, totalMax] = candidate.max;
        const defenseMaxWithAttackMin = defenseMax + attackMin;
        const attackMaxWithDefenseMin = attackMax + defenseMin;
        // Every side extremum must be attainable with some total in the stored range.
        if (totalMin < defenseMin + attackMin || totalMax > defenseMax + attackMax ||
            totalMax < Math.max(defenseMaxWithAttackMin, attackMaxWithDefenseMin) ||
            totalMin > Math.min(defenseMaxWithAttackMin, attackMaxWithDefenseMin)) invalid();
      }
    }
    for (const total of Object.values(state.guildVictimKoTotals)) {
      if (!record(total) || !count(total.totalVictimKoCount) || (total.guildName !== null && typeof total.guildName !== "string")) invalid();
    }
  }
}

function invalid(): never {
  throw new Error("Unsupported or corrupt observation checkpoint; existing data preserved.");
}
