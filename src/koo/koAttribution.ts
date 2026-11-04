import { advanceKoCandidates, initialKoCandidates, minimumFreshPartySize, type KoCandidate, type KoBattleCounts, type KoLowerBound, type KoTransition } from "./koAttributionCandidates.js";

export type KoObservationBoundary = "fallen_baseline" | "counterattack_baseline";

export type KoCastleObservation = {
  castleId: number;
  defenderGuildId: string | null;
  defenderGuildName: string | null;
  attackerGuildId: string | null;
  attackerGuildName: string | null;
  defensePartyCount: number;
  attackPartyCount: number;
  koCount: number;
  observedAt: Date;
  normalBattlePhase?: boolean;
  boundary?: KoObservationBoundary;
  freshPartyKoLowerBound?: KoLowerBound;
};

export type KoSideSnapshot = {
  guildId: string | null;
  guildName: string | null;
  koVictimCount: number;
  lastCheckpointSlot: number | null;
  updatedAt: Date;
};

export type KoCastlePublicSnapshot = {
  castleId: number;
  updatedAt: Date;
  lastObservedAt: Date;
  defender: KoSideSnapshot;
  attacker: KoSideSnapshot;
};

export type KoCastleState = {
  castleId: number;
  candidates: KoCandidate[];
  closedUnresolvedKo: [number, number];
  modelMismatchCount: number;
  lastKoCount: number | null;
  lastDefensePartyCount: number | null;
  lastAttackPartyCount: number | null;
  defenseVictimKoTotal: number;
  attackVictimKoTotal: number;
  lastCheckpointSlot: number | null;
  defenderGuildId: string | null;
  defenderGuildName: string | null;
  attackerGuildId: string | null;
  attackerGuildName: string | null;
  lastObservedAt: Date | null;
  lastUpdatedAt: Date | null;
  guildVictimKoTotals: Record<string, GuildVictimKoTotal>;
};

export type GuildVictimKoTotal = {
  guildName: string | null;
  totalVictimKoCount: number;
};

export type KoStateUpdateResult = {
  state: KoCastleState;
  shouldPersistCastle: boolean;
  shouldUpdateGuildTotals: boolean;
  checkpointSlot: number | null;
  freshBattleZero: boolean;
  reasons: KoPersistReason[];
  decision: {
    previous: KoBattleCounts | null;
    previousGuilds: { defenderGuildId: string | null; attackerGuildId: string | null } | null;
    current: KoBattleCounts;
    transitions: Array<KoTransition | KoObservationBoundary | "baseline" | "reset" | "model_mismatch" | "unverified_zero_baseline">;
    defenseCredit: number;
    attackCredit: number;
  };
};

export type KoPersistReason =
  | "ko_decreased"
  | "ko_increased"
  | "model_mismatch"
  | KoObservationBoundary
  | "guilds_changed";


const CHECKPOINT_SECONDS = 30;

export function createInitialKoCastleState(castleId: number): KoCastleState {
  return {
    castleId,
    candidates: initialKoCandidates(),
    closedUnresolvedKo: [0, 0],
    modelMismatchCount: 0,
    lastKoCount: null,
    lastDefensePartyCount: null,
    lastAttackPartyCount: null,
    defenseVictimKoTotal: 0,
    attackVictimKoTotal: 0,
    lastCheckpointSlot: null,
    defenderGuildId: null,
    defenderGuildName: null,
    attackerGuildId: null,
    attackerGuildName: null,
    lastObservedAt: null,
    lastUpdatedAt: null,
    guildVictimKoTotals: {},
  };
}

export function resetKoEvidence(state: KoCastleState): KoCastleState {
  const candidates = state.candidates;
  const closed: [number, number] = candidates.length
    ? [Math.min(...candidates.map(c => c.min[2])), Math.max(...candidates.map(c => c.max[2]))] : [0, 0];
  return { ...state, candidates: initialKoCandidates(),
    closedUnresolvedKo: [state.closedUnresolvedKo[0] + closed[0], state.closedUnresolvedKo[1] + closed[1]],
    lastKoCount: null, lastDefensePartyCount: null, lastAttackPartyCount: null };
}

export function applyKoObservation(previousState: KoCastleState | undefined, observation: KoCastleObservation,
  previousFreshBattleZero = false): KoStateUpdateResult {
  const checkpointSlot = calculateCheckpointSlot(observation.observedAt);
  let state = previousState ? structuredClone(previousState) : createInitialKoCastleState(observation.castleId);
  const changed = previousState !== undefined && (state.defenderGuildId !== observation.defenderGuildId || state.attackerGuildId !== observation.attackerGuildId);
  const reasons: KoPersistReason[] = [];
  if (changed) {
    state = resetKoEvidence(state);
    state.defenseVictimKoTotal = 0; state.attackVictimKoTotal = 0;
    reasons.push("guilds_changed");
  }
  state.defenderGuildId = observation.defenderGuildId; state.defenderGuildName = observation.defenderGuildName;
  state.attackerGuildId = observation.attackerGuildId; state.attackerGuildName = observation.attackerGuildName;
  let defenseCredit = 0, attackCredit = 0;
  const current = { ko: observation.koCount, defense: observation.defensePartyCount, attack: observation.attackPartyCount };
  const previous = !previousState || previousState.lastKoCount === null || previousState.lastDefensePartyCount === null || previousState.lastAttackPartyCount === null
    ? null : { ko: previousState.lastKoCount, defense: previousState.lastDefensePartyCount, attack: previousState.lastAttackPartyCount };
  const comparison = changed ? null : previous;
  const freshBattleZero = current.ko === 0 && observation.normalBattlePhase !== false && !observation.boundary &&
    (checkpointSlot === null || (previousFreshBattleZero && comparison?.ko === 0)) &&
    (!comparison || (current.defense >= comparison.defense && current.attack >= comparison.attack));
  const previousGuilds = previous && previousState
    ? { defenderGuildId: previousState.defenderGuildId, attackerGuildId: previousState.attackerGuildId } : null;
  const decision: KoStateUpdateResult["decision"] = { previous, previousGuilds, current, transitions: ["baseline"], defenseCredit: 0, attackCredit: 0 };
  if (observation.boundary) {
    state = resetKoEvidence(state);
    decision.transitions = [observation.boundary];
    reasons.push(observation.boundary);
  } else if (checkpointSlot !== null && comparison) {
    const previousKo = comparison.ko;
    if (observation.koCount === 0) { state = resetKoEvidence(state); decision.transitions = ["reset"]; }
    else if (previousKo === 0 && (!previousFreshBattleZero || observation.normalBattlePhase === false)) {
      decision.transitions = ["unverified_zero_baseline"];
    } else {
      const result = advanceKoCandidates(state.candidates,
        comparison, current, observation.freshPartyKoLowerBound ?? minimumFreshPartySize(observation.castleId));
      decision.transitions = result.candidates.length ? result.transitions : ["model_mismatch"];
      if (!result.candidates.length) { state = resetKoEvidence(state); state.modelMismatchCount++; reasons.push("model_mismatch"); }
      else {
        state.candidates = result.candidates;
        defenseCredit = observation.defenderGuildId ? result.defenseCredit : 0;
        attackCredit = observation.attackerGuildId ? result.attackCredit : 0;
        const unassigned = result.defenseCredit + result.attackCredit - defenseCredit - attackCredit;
        state.closedUnresolvedKo = [state.closedUnresolvedKo[0] + unassigned, state.closedUnresolvedKo[1] + unassigned];
        state.defenseVictimKoTotal += defenseCredit; state.attackVictimKoTotal += attackCredit;
        recordGuildVictimKo(state, observation.defenderGuildId, observation.defenderGuildName, defenseCredit);
        recordGuildVictimKo(state, observation.attackerGuildId, observation.attackerGuildName, attackCredit);
      }
    }
    if (observation.koCount > previousKo) reasons.push("ko_increased");
    if (observation.koCount < previousKo) reasons.push("ko_decreased");
  }
  state.lastObservedAt = observation.observedAt;
  state.lastUpdatedAt = observation.observedAt;
  state.lastCheckpointSlot = checkpointSlot;
  updateLastRawCounts(state, observation);
  decision.defenseCredit = defenseCredit; decision.attackCredit = attackCredit;
  return { state, decision, shouldPersistCastle: changed || defenseCredit + attackCredit > 0 || reasons.length > 0,
    shouldUpdateGuildTotals: defenseCredit + attackCredit > 0, checkpointSlot, freshBattleZero, reasons };
}

export function createKoCastlePublicSnapshot(state: KoCastleState): KoCastlePublicSnapshot {
  const updatedAt = state.lastUpdatedAt ?? state.lastObservedAt ?? new Date(0);
  const lastObservedAt = state.lastObservedAt ?? updatedAt;
  return {
    castleId: state.castleId,
    updatedAt,
    lastObservedAt,
    defender: {
      guildId: state.defenderGuildId,
      guildName: state.defenderGuildName,
      koVictimCount: state.defenseVictimKoTotal,
      lastCheckpointSlot: state.lastCheckpointSlot,
      updatedAt,
    },
    attacker: {
      guildId: state.attackerGuildId,
      guildName: state.attackerGuildName,
      koVictimCount: state.attackVictimKoTotal,
      lastCheckpointSlot: state.lastCheckpointSlot,
      updatedAt,
    },
  };
}

export function calculateGuildKoTotals(
  states: Iterable<KoCastleState>,
): Map<string, { guildName: string | null; totalVictimKoCount: number; sourceUpdatedAt: Date }> {
  const totals = new Map<
    string,
    { guildName: string | null; totalVictimKoCount: number; sourceUpdatedAt: Date }
  >();

  for (const state of states) {
    for (const [guildId, entry] of Object.entries(state.guildVictimKoTotals)) {
      addGuildKoTotal(totals, guildId, entry.guildName, entry.totalVictimKoCount, state);
    }
  }

  return totals;
}

export function calculateCheckpointSlot(observedAt: Date): number | null {
  const parts = getJstDateTimeParts(observedAt);
  const battleStartUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    11,
    45,
    0,
    0,
  );
  const elapsedMilliseconds = observedAt.getTime() - battleStartUtcMs;
  if (elapsedMilliseconds < 0) {
    return null;
  }

  return Math.floor(elapsedMilliseconds / (CHECKPOINT_SECONDS * 1000));
}

function recordGuildVictimKo(
  state: KoCastleState,
  guildId: string | null,
  guildName: string | null,
  koCount: number,
): void {
  if (!guildId || koCount <= 0) {
    return;
  }

  const existingTotal = state.guildVictimKoTotals[guildId];
  state.guildVictimKoTotals[guildId] = {
    guildName: existingTotal?.guildName ?? guildName,
    totalVictimKoCount: (existingTotal?.totalVictimKoCount ?? 0) + koCount,
  };
}

function updateLastRawCounts(state: KoCastleState, observation: KoCastleObservation): void {
  state.lastKoCount = observation.koCount;
  state.lastDefensePartyCount = observation.defensePartyCount;
  state.lastAttackPartyCount = observation.attackPartyCount;
}

function addGuildKoTotal(
  totals: Map<string, { guildName: string | null; totalVictimKoCount: number; sourceUpdatedAt: Date }>,
  guildId: string | null,
  guildName: string | null,
  koVictimCount: number,
  state: KoCastleState,
): void {
  if (!guildId || koVictimCount <= 0) {
    return;
  }

  const sourceUpdatedAt = state.lastUpdatedAt ?? state.lastObservedAt ?? new Date(0);
  const existingTotal = totals.get(guildId);
  if (!existingTotal) {
    totals.set(guildId, {
      guildName,
      totalVictimKoCount: koVictimCount,
      sourceUpdatedAt,
    });
    return;
  }

  existingTotal.totalVictimKoCount += koVictimCount;
  if (!existingTotal.guildName && guildName) {
    existingTotal.guildName = guildName;
  }
  if (sourceUpdatedAt > existingTotal.sourceUpdatedAt) {
    existingTotal.sourceUpdatedAt = sourceUpdatedAt;
  }
}

function getJstDateTimeParts(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const partByType = new Map(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(partByType.get("year")),
    month: Number(partByType.get("month")),
    day: Number(partByType.get("day")),
  };
}
