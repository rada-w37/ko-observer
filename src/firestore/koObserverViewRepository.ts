import type { Firestore } from "firebase-admin/firestore";

const KO_OBSERVER_VIEWS_COLLECTION = "koObserverViews";
const PHASE0_SMOKE_TEST_DOCUMENT_ID = "phase0_smoke_test";

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
