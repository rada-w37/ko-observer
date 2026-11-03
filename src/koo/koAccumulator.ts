import {
  applyKoObservation,
  resetKoEvidence,
  calculateGuildKoTotals,
  type KoCastleObservation,
  type KoCastleState,
  type KoStateUpdateResult,
} from "./koAttribution.js";

export type KoAccumulatorSnapshot = {
  revision: number;
  castleStates: KoCastleState[];
};

export type KoAccumulatorUpdate = KoStateUpdateResult & {
  revision: number;
  rebased: boolean;
};

export class KoAccumulator {
  private readonly castleStates = new Map<number, KoCastleState>();
  private readonly observedCastleIds = new Set<number>();
  private revision: number;

  constructor(snapshot: KoAccumulatorSnapshot = { revision: 0, castleStates: [] }) {
    const restoredSnapshot = structuredClone(snapshot);
    this.revision = restoredSnapshot.revision;
    for (const state of restoredSnapshot.castleStates) {
      this.castleStates.set(state.castleId, state);
    }
  }

  beginObservationEpoch(): void {
    this.observedCastleIds.clear();
  }

  get currentRevision(): number { return this.revision; }

  observe(observation: KoCastleObservation): KoAccumulatorUpdate {
    const previousState = this.castleStates.get(observation.castleId);
    const rebased = previousState !== undefined && !this.observedCastleIds.has(observation.castleId);
    const comparisonState = rebased ? resetKoEvidence(previousState!) : previousState;
    const result = applyKoObservation(comparisonState, structuredClone(observation));
    this.castleStates.set(observation.castleId, result.state);
    this.observedCastleIds.add(observation.castleId);
    this.revision += 1;

    return structuredClone({
      ...result,
      shouldPersistCastle: result.shouldPersistCastle || rebased,
      revision: this.revision,
      rebased,
    });
  }

  exportSnapshot(): KoAccumulatorSnapshot {
    return structuredClone({
      revision: this.revision,
      castleStates: [...this.castleStates.values()],
    });
  }

  getGuildTotals(): ReturnType<typeof calculateGuildKoTotals> {
    return structuredClone(calculateGuildKoTotals(this.castleStates.values()));
  }
}
