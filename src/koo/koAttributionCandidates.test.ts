import assert from "node:assert/strict";
import test from "node:test";
import { advanceKoCandidates, initialKoCandidates, minimumFreshPartySize, type KoCandidate } from "./koAttributionCandidates.js";

const known = (): KoCandidate[] => [{ side: "defense", min: [0, 0, 0], max: [0, 0, 0] }];
test("castle minimums and transition lower bounds", () => {
  for (let id = 1; id <= 21; id++) assert.equal(minimumFreshPartySize(id), id <= 5 ? 3 : 2);
  const previous = { ko: 2, defense: 100, attack: 100 };
  assert.equal(advanceKoCandidates(known(), previous, { ...previous, ko: 4 }, 3).attackCredit, 4);
  const ambiguous = advanceKoCandidates(known(), previous, { ...previous, ko: 4 }, 2);
  assert.equal(ambiguous.candidates.length, 2);
  assert.equal(ambiguous.defenseCredit + ambiguous.attackCredit, 0);
  const resolved = advanceKoCandidates(ambiguous.candidates, { ...previous, ko: 4 }, { ko: 7, defense: 99, attack: 100 }, 2);
  assert.equal(resolved.defenseCredit, 5);
  assert.equal(advanceKoCandidates(known(), previous, { ...previous, ko: 3 }, 2).attackCredit, 3);
});
test("same KO can switch; one survivor is counted; stable large streak continues", () => {
  assert.equal(advanceKoCandidates(known(), { ko: 2, defense: 100, attack: 100 }, { ko: 2, defense: 100, attack: 99 }, 3).attackCredit, 2);
  assert.equal(advanceKoCandidates(known(), { ko: 10, defense: 100, attack: 100 }, { ko: 1, defense: 100, attack: 100 }, 3).attackCredit, 1);
  assert.equal(advanceKoCandidates(known(), { ko: 7, defense: 100, attack: 100 }, { ko: 10, defense: 100, attack: 100 }, 3).defenseCredit, 3);
  assert.equal(advanceKoCandidates(known(), { ko: 7, defense: 100, attack: 100 }, { ko: 8, defense: 100, attack: 100 }, 3).candidates.length, 0);
});
test("compressed ranges agree with independently enumerated battle histories", () => {
  let seed = 314159;
  const random = (limit: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  for (const minimum of [2, 3] as const) for (let run = 0; run < 300; run++) {
    let candidates = initialKoCandidates();
    let histories = [0, 1].map((side) => ({ side, defense: 0, attack: 0 }));
    let previous = { ko: 0, defense: 100, attack: 100 };
    let actualSide = 0;
    for (let step = 0; step < 8; step++) {
      const action = random(3);
      const current = { ...previous, defense: previous.defense + random(3), attack: previous.attack + random(3) };
      if (action) {
        if (action === 2) actualSide = 1 - actualSide;
        current.ko = action === 2 ? 1 + random(5) : previous.ko + minimum + random(6 - minimum);
        if (actualSide === 0) current.defense--; else current.attack--;
      }
      const expanded: typeof histories = [];
      for (const history of histories) for (const battle of [false, true]) for (const loser of [0, 1]) {
        if (!battle && loser !== history.side) continue;
        const amount = !battle ? 0 : loser === history.side ? current.ko - previous.ko : current.ko;
        if (!battle && current.ko !== previous.ko) continue;
        if (battle && (amount < (loser === history.side ? minimum : 1) || amount > 5)) continue;
        if (current.defense - previous.defense < (battle && loser === 0 ? -1 : 0) ||
            current.attack - previous.attack < (battle && loser === 1 ? -1 : 0)) continue;
        expanded.push({ side: loser, defense: history.defense + (loser === 0 ? amount : 0), attack: history.attack + (loser === 1 ? amount : 0) });
      }
      const defense = Math.min(...expanded.map((h) => h.defense));
      const attack = Math.min(...expanded.map((h) => h.attack));
      histories = [...new Map(expanded.map((h) => [JSON.stringify(h), h])).values()].map((h) => ({ ...h, defense: h.defense - defense, attack: h.attack - attack }));
      const result = advanceKoCandidates(candidates, previous, current, minimum);
      assert.equal(result.defenseCredit, defense); assert.equal(result.attackCredit, attack);
      assert.deepEqual(new Set(result.candidates.map((candidate) => candidate.side)),
        new Set(histories.map((history) => history.side === 0 ? "defense" : "attack")));
      assert.ok(result.candidates.length <= 2);
      for (const candidate of result.candidates) {
        const matching = histories.filter((h) => h.side === (candidate.side === "defense" ? 0 : 1));
        const amounts = matching.map((h) => [h.defense, h.attack, h.defense + h.attack]);
        assert.deepEqual(candidate.min, [0, 1, 2].map((i) => Math.min(...amounts.map((n) => n[i]))));
        assert.deepEqual(candidate.max, [0, 1, 2].map((i) => Math.max(...amounts.map((n) => n[i]))));
      }
      candidates = result.candidates; previous = current;
    }
  }
});
