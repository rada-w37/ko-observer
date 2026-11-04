export type VictimSide = "defense" | "attack";
export type KoTransition = "no_battle" | "first_battle" | "continuation" | "switch";
export type KoLowerBound = 1 | 2 | 3;
export type KoCandidate = { side: VictimSide; min: [number, number, number]; max: [number, number, number] };
export type KoBattleCounts = { ko: number; defense: number; attack: number };

export function battleCastleKind(castleId: number): "temple" | "castle" | "church" {
  if (!Number.isInteger(castleId) || castleId < 1 || castleId > 21) throw new Error("Unknown battle castle.");
  return castleId === 1 ? "temple" : castleId <= 5 ? "castle" : "church";
}

export function minimumFreshPartySize(castleId: number): 2 | 3 {
  return battleCastleKind(castleId) === "church" ? 2 : 3;
}

export function initialKoCandidates(): KoCandidate[] {
  return ["defense", "attack"].map((side) => ({ side: side as VictimSide, min: [0, 0, 0], max: [0, 0, 0] }));
}

export function advanceKoCandidates(candidates: readonly KoCandidate[], previous: KoBattleCounts,
  current: KoBattleCounts, minimum: KoLowerBound): { candidates: KoCandidate[]; defenseCredit: number; attackCredit: number; transitions: KoTransition[] } {
  const transitions = new Set<KoTransition>();
  const groups = new Map<VictimSide, KoCandidate>();
  const defenseDelta = current.defense - previous.defense;
  const attackDelta = current.attack - previous.attack;
  const delta = current.ko - previous.ko;
  const fits = (side: VictimSide) => side === "defense"
    ? defenseDelta >= -1 && attackDelta >= 0 : attackDelta >= -1 && defenseDelta >= 0;
  const add = (source: KoCandidate, side: VictimSide, defense: number, attack: number, transition: KoTransition) => {
    transitions.add(transition);
    const credit = [defense, attack, defense + attack];
    const next: KoCandidate = { side, min: source.min.map((n, i) => n + credit[i]) as KoCandidate["min"],
      max: source.max.map((n, i) => n + credit[i]) as KoCandidate["max"] };
    const existing = groups.get(side);
    if (existing) {
      next.min = next.min.map((n, i) => Math.min(n, existing.min[i])) as KoCandidate["min"];
      next.max = next.max.map((n, i) => Math.max(n, existing.max[i])) as KoCandidate["max"];
    }
    groups.set(side, next);
  };
  for (const candidate of candidates) {
    if (delta === 0 && defenseDelta >= 0 && attackDelta >= 0) add(candidate, candidate.side, 0, 0, "no_battle");
    if (delta >= minimum && delta <= 5 && fits(candidate.side)) {
      add(candidate, candidate.side, candidate.side === "defense" ? delta : 0, candidate.side === "attack" ? delta : 0,
        previous.ko === 0 ? "first_battle" : "continuation");
    }
    const opposite = candidate.side === "defense" ? "attack" : "defense";
    if (previous.ko > 0 && current.ko >= 1 && current.ko <= 5 && fits(opposite)) {
      add(candidate, opposite, opposite === "defense" ? current.ko : 0, opposite === "attack" ? current.ko : 0, "switch");
    }
  }
  const next = [...groups.values()];
  const defenseCredit = next.length ? Math.min(...next.map((candidate) => candidate.min[0])) : 0;
  const attackCredit = next.length ? Math.min(...next.map((candidate) => candidate.min[1])) : 0;
  const credited = [defenseCredit, attackCredit, defenseCredit + attackCredit];
  return { candidates: next.map((candidate) => ({ ...candidate,
    min: candidate.min.map((n, i) => n - credited[i]) as KoCandidate["min"],
    max: candidate.max.map((n, i) => n - credited[i]) as KoCandidate["max"] })), defenseCredit, attackCredit, transitions: [...transitions] };
}
