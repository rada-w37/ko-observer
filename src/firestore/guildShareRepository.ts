import type { Firestore } from "firebase-admin/firestore";

const GUILD_SHARES_COLLECTION = "guildShares";

export type MonitorGuildTarget =
  | {
      status: "ok";
      worldId: string;
      guildId: string;
      guildName: string;
    }
  | {
      status: "empty";
      message: "No guild configuration found.";
    }
  | {
      status: "multiple";
      message: "Multiple guild configurations found.";
      count: number;
    };

type GuildShareData = {
  guildName?: unknown;
  world?: unknown;
};

export async function loadMonitorGuildTargetFromGuildShares(
  firestore: Firestore,
): Promise<MonitorGuildTarget> {
  const documentReferences = await firestore.collection(GUILD_SHARES_COLLECTION).listDocuments();

  if (documentReferences.length === 0) {
    return {
      status: "empty",
      message: "No guild configuration found.",
    };
  }

  if (documentReferences.length > 1) {
    return {
      status: "multiple",
      message: "Multiple guild configurations found.",
      count: documentReferences.length,
    };
  }

  const documentReference = documentReferences[0];
  if (!documentReference) {
    return {
      status: "empty",
      message: "No guild configuration found.",
    };
  }

  const snapshot = await documentReference.get();
  const data = snapshot.data() as GuildShareData | undefined;
  const world = normalizeWorld(data?.world);
  const guildName = typeof data?.guildName === "string" ? data.guildName : "";

  if (world === null) {
    throw new Error(`guildShares/${documentReference.id} world must be an integer between 1 and 999.`);
  }

  if (!guildName.trim()) {
    throw new Error(`guildShares/${documentReference.id} guildName is required.`);
  }

  return {
    status: "ok",
    worldId: (1000 + world).toString(),
    guildId: documentReference.id,
    guildName,
  };
}

function normalizeWorld(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 999) {
    return null;
  }

  return value;
}
