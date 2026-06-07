import type { Firestore } from "firebase-admin/firestore";
import type { ActiveGuilds } from "../koo/activeGuildExtractor.js";
import type { BattleStatusResolution, BattleType } from "../koo/battleStatusResolver.js";

const KO_OBSERVER_VIEWS_COLLECTION = "koObserverViews";
const PHASE0_SMOKE_TEST_DOCUMENT_ID = "phase0_smoke_test";
const PHASE1_SCOPE_TEST_DOCUMENT_ID = "phase1_scope_test";

type WritePhase0SmokeTestViewInput = {
  battleDate: string;
  runId: string;
};

type KoObserverView = {
  battleDate: string;
  battleType: "guildBattle";
  worldId: string;
  scope: {
    type: "world";
    id: string;
  };
  status: "stopped";
  activeGuilds: Record<string, never>;
  startedAt: string;
  updatedAt: string;
  stoppedAt: string;
  source: {
    app: "KOO";
    runId: string;
  };
};

type WritePhase1ScopeTestViewInput = {
  battleDate: string;
  mode: string;
  runId: string;
  worldId: string;
  battleStatus: BattleStatusResolution;
  activeGuilds: ActiveGuilds;
  localGvgCastleCount: number;
};

type Phase1ScopeTestView = {
  battleDate: string;
  battleType: BattleType;
  mode: string;
  worldId: string;
  scope: BattleStatusResolution["scope"];
  status: "stopped";
  activeGuilds: ActiveGuilds;
  phase1: {
    isGuildBattleActive: boolean;
    localGvgCastleCount: number;
    activeGuildCount: number;
  };
  startedAt: string;
  updatedAt: string;
  stoppedAt: string;
  source: {
    app: "KOO";
    runId: string;
  };
};

export async function writePhase0SmokeTestView(
  firestore: Firestore,
  input: WritePhase0SmokeTestViewInput,
): Promise<void> {
  const nowIsoString = new Date().toISOString();
  const koObserverView: KoObserverView = {
    battleDate: input.battleDate,
    battleType: "guildBattle",
    worldId: "phase0",
    scope: {
      type: "world",
      id: "phase0",
    },
    status: "stopped",
    activeGuilds: {},
    startedAt: nowIsoString,
    updatedAt: nowIsoString,
    stoppedAt: nowIsoString,
    source: {
      app: "KOO",
      runId: input.runId,
    },
  };

  await firestore
    .collection(KO_OBSERVER_VIEWS_COLLECTION)
    .doc(PHASE0_SMOKE_TEST_DOCUMENT_ID)
    .set(koObserverView);
}

export async function writePhase1ScopeTestView(
  firestore: Firestore,
  input: WritePhase1ScopeTestViewInput,
): Promise<void> {
  const nowIsoString = new Date().toISOString();
  const phase1ScopeTestView: Phase1ScopeTestView = {
    battleDate: input.battleDate,
    battleType: input.battleStatus.battleType,
    mode: input.mode,
    worldId: input.worldId,
    scope: input.battleStatus.scope,
    status: "stopped",
    activeGuilds: input.activeGuilds,
    phase1: {
      isGuildBattleActive: input.battleStatus.isGuildBattleActive,
      localGvgCastleCount: input.localGvgCastleCount,
      activeGuildCount: Object.keys(input.activeGuilds).length,
    },
    startedAt: nowIsoString,
    updatedAt: nowIsoString,
    stoppedAt: nowIsoString,
    source: {
      app: "KOO",
      runId: input.runId,
    },
  };

  await firestore
    .collection(KO_OBSERVER_VIEWS_COLLECTION)
    .doc(PHASE1_SCOPE_TEST_DOCUMENT_ID)
    .set(phase1ScopeTestView);
}
