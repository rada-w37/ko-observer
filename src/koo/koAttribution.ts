export type AttributionMode = "unknown" | "defenseVictim" | "attackVictim";

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
  lastKoCount: number | null;
  lastDefensePartyCount: number | null;
  lastAttackPartyCount: number | null;
  attributionMode: AttributionMode;
  defenseVictimKoTotal: number;
  attackVictimKoTotal: number;
  unknownVictimKo: number;
  pendingDefenseVictimKo: number;
  pendingAttackVictimKo: number;
  pendingUnknownInitialKo: number;
  lastCheckpointSlot: number | null;
  suspiciousSwitch: boolean;
  defenderGuildId: string | null;
  defenderGuildName: string | null;
  attackerGuildId: string | null;
  attackerGuildName: string | null;
  lastObservedAt: Date | null;
  lastUpdatedAt: Date | null;
  hasKoChangeSinceLastCheckpoint: boolean;
};

export type KoStateUpdateResult = {
  state: KoCastleState;
  shouldPersistCastle: boolean;
  shouldUpdateGuildTotals: boolean;
  checkpointSlot: number | null;
  reasons: KoPersistReason[];
};

export type KoPersistReason = "ko_decreased" | "ko_increased" | "checkpoint_elapsed";

const ATTRIBUTION_CONFIRMATION_THRESHOLD = 6;
const CHECKPOINT_SECONDS = 30;

export function createInitialKoCastleState(castleId: number): KoCastleState {
  return {
    castleId,
    lastKoCount: null,
    lastDefensePartyCount: null,
    lastAttackPartyCount: null,
    attributionMode: "unknown",
    defenseVictimKoTotal: 0,
    attackVictimKoTotal: 0,
    unknownVictimKo: 0,
    pendingDefenseVictimKo: 0,
    pendingAttackVictimKo: 0,
    pendingUnknownInitialKo: 0,
    lastCheckpointSlot: null,
    suspiciousSwitch: false,
    defenderGuildId: null,
    defenderGuildName: null,
    attackerGuildId: null,
    attackerGuildName: null,
    lastObservedAt: null,
    lastUpdatedAt: null,
    hasKoChangeSinceLastCheckpoint: false,
  };
}

export function applyKoObservation(
  previousState: KoCastleState | undefined,
  observation: KoCastleObservation,
): KoStateUpdateResult {
  const checkpointSlot = calculateCheckpointSlot(observation.observedAt);
  const state = previousState
    ? { ...previousState }
    : createInitialKoCastleState(observation.castleId);
  const reasons = new Set<KoPersistReason>();
  let shouldUpdateGuildTotals = false;

  state.defenderGuildId = observation.defenderGuildId;
  state.defenderGuildName = observation.defenderGuildName;
  state.attackerGuildId = observation.attackerGuildId;
  state.attackerGuildName = observation.attackerGuildName;
  state.lastObservedAt = observation.observedAt;

  if (checkpointSlot === null) {
    updateLastRawCounts(state, observation);
    return {
      state,
      shouldPersistCastle: false,
      shouldUpdateGuildTotals: false,
      checkpointSlot: null,
      reasons: [],
    };
  }

  if (
    state.lastKoCount === null ||
    state.lastDefensePartyCount === null ||
    state.lastAttackPartyCount === null
  ) {
    updateLastRawCounts(state, observation);
    state.lastCheckpointSlot = checkpointSlot;
    state.lastUpdatedAt = observation.observedAt;
    return {
      state,
      shouldPersistCastle: false,
      shouldUpdateGuildTotals: false,
      checkpointSlot,
      reasons: [],
    };
  }

  const koDelta = observation.koCount - state.lastKoCount;
  const defenseDelta = observation.defensePartyCount - state.lastDefensePartyCount;
  const attackDelta = observation.attackPartyCount - state.lastAttackPartyCount;

  if (koDelta > 0) {
    applyKoIncrease(state, koDelta, defenseDelta, attackDelta);
    state.hasKoChangeSinceLastCheckpoint = true;
    state.lastUpdatedAt = observation.observedAt;
    reasons.add("ko_increased");
    shouldUpdateGuildTotals = true;
  } else if (koDelta < 0) {
    if (state.pendingUnknownInitialKo > 0) {
      state.unknownVictimKo += state.pendingUnknownInitialKo;
    }
    state.attributionMode = "unknown";
    state.pendingDefenseVictimKo = 0;
    state.pendingAttackVictimKo = 0;
    state.pendingUnknownInitialKo = observation.koCount > 0 ? observation.koCount : 0;
    state.suspiciousSwitch = false;
    state.hasKoChangeSinceLastCheckpoint = false;
    state.lastUpdatedAt = observation.observedAt;
    reasons.add("ko_decreased");
    shouldUpdateGuildTotals = true;
  }

  const checkpointElapsed =
    checkpointSlot !== state.lastCheckpointSlot && state.hasKoChangeSinceLastCheckpoint;
  if (checkpointElapsed) {
    state.lastCheckpointSlot = checkpointSlot;
    state.hasKoChangeSinceLastCheckpoint = false;
    state.lastUpdatedAt = observation.observedAt;
    reasons.add("checkpoint_elapsed");
  }

  updateLastRawCounts(state, observation);

  return {
    state,
    shouldPersistCastle: reasons.has("ko_decreased") || reasons.has("checkpoint_elapsed"),
    shouldUpdateGuildTotals,
    checkpointSlot,
    reasons: [...reasons],
  };
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
    addGuildKoTotal(totals, state.defenderGuildId, state.defenderGuildName, state.defenseVictimKoTotal, state);
    addGuildKoTotal(totals, state.attackerGuildId, state.attackerGuildName, state.attackVictimKoTotal, state);
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

function applyKoIncrease(
  state: KoCastleState,
  koDelta: number,
  defenseDelta: number,
  attackDelta: number,
): void {
  if (state.attributionMode === "defenseVictim") {
    state.defenseVictimKoTotal += koDelta;
    if (attackDelta < 0 && defenseDelta >= 0) {
      state.suspiciousSwitch = true;
    }
    return;
  }

  if (state.attributionMode === "attackVictim") {
    state.attackVictimKoTotal += koDelta;
    if (defenseDelta < 0 && attackDelta >= 0) {
      state.suspiciousSwitch = true;
    }
    return;
  }

  if (defenseDelta < 0 && attackDelta >= 0) {
    const attributedKo = consumePendingUnknownInitialKo(state) + koDelta;
    state.defenseVictimKoTotal += attributedKo;
    state.pendingDefenseVictimKo += attributedKo;
    if (state.defenseVictimKoTotal > ATTRIBUTION_CONFIRMATION_THRESHOLD) {
      state.attributionMode = "defenseVictim";
    }
    return;
  }

  if (attackDelta < 0 && defenseDelta >= 0) {
    const attributedKo = consumePendingUnknownInitialKo(state) + koDelta;
    state.attackVictimKoTotal += attributedKo;
    state.pendingAttackVictimKo += attributedKo;
    if (state.attackVictimKoTotal > ATTRIBUTION_CONFIRMATION_THRESHOLD) {
      state.attributionMode = "attackVictim";
    }
    return;
  }

  state.unknownVictimKo += consumePendingUnknownInitialKo(state) + koDelta;
}

function consumePendingUnknownInitialKo(state: KoCastleState): number {
  const pendingUnknownInitialKo = state.pendingUnknownInitialKo;
  state.pendingUnknownInitialKo = 0;
  return pendingUnknownInitialKo;
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
