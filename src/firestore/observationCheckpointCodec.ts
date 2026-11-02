import { Timestamp } from "firebase-admin/firestore";
import { createObservationIdentity, type ObservationCheckpoint } from "../koo/observationRun.js";

const nullableDates = ["lastObservedAt", "lastUpdatedAt"];
const nullableCounts = ["lastKoCount", "lastDefensePartyCount", "lastAttackPartyCount", "lastCheckpointSlot"];
const counts = ["defenseVictimKoTotal", "attackVictimKoTotal", "unknownVictimKo", "pendingDefenseVictimKo", "pendingAttackVictimKo", "pendingUnknownInitialKo"];
const nullableNames = ["defenderGuildId", "defenderGuildName", "attackerGuildId", "attackerGuildName"];

export function encodeObservationCheckpoint(checkpoint: ObservationCheckpoint): Record<string, unknown> {
  validate(checkpoint);
  return transform(checkpoint, true) as Record<string, unknown>;
}

export function decodeObservationCheckpoint(stored: unknown): ObservationCheckpoint {
  const checkpoint = transform(stored, false);
  validate(checkpoint);
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

function validate(input: unknown): asserts input is ObservationCheckpoint {
  if (!record(input) || input.schemaVersion !== 1 || !record(input.identity) || !record(input.accumulator)) invalid();
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
    if (!["unknown", "defenseVictim", "attackVictim"].includes(state.attributionMode) ||
        typeof state.suspiciousSwitch !== "boolean" || typeof state.hasKoChangeSinceLastCheckpoint !== "boolean" || !record(state.guildVictimKoTotals)) invalid();
    for (const total of Object.values(state.guildVictimKoTotals)) {
      if (!record(total) || !count(total.totalVictimKoCount) || (total.guildName !== null && typeof total.guildName !== "string")) invalid();
    }
  }
}

function invalid(): never {
  throw new Error("Unsupported or corrupt observation checkpoint; existing data preserved.");
}
