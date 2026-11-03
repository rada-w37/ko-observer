import { createHash } from "node:crypto";
import type { KoAccumulatorSnapshot } from "./koAccumulator.js";

export type ObservationIdentity = {
  battleDate: string;
  battleType: "guildBattle" | "grandBattle";
  streamId: number;
  sessionId: string;
};

export function createObservationIdentity(
  battleDate: string,
  battleType: ObservationIdentity["battleType"],
  streamId: number,
): ObservationIdentity {
  const sessionId = createHash("sha256").update(JSON.stringify([battleDate, battleType, streamId])).digest("hex");
  return { battleDate, battleType, streamId, sessionId };
}

export type ObservationCheckpoint = {
  schemaVersion: 2;
  identity: ObservationIdentity;
  accumulator: KoAccumulatorSnapshot;
  guildNames: Record<string, string>;
  participantGuilds: Record<string, string>;
  updatedAt: Date;
};

export type ObservationLease = {
  ownerId: string;
  fenceToken: number;
  validUntil: number;
};

export interface ObservationRunStore {
  acquire(): Promise<ObservationLease>;
  renew(lease: ObservationLease): Promise<ObservationLease>;
  resume(lease: ObservationLease, identity: ObservationIdentity, participants: Record<string, string>, startedAt: Date): Promise<{ checkpoint: ObservationCheckpoint; resumed: boolean }>;
  commit(lease: ObservationLease, checkpoint: ObservationCheckpoint, castleIds: number[], publishTotals: boolean): Promise<void>;
  release(lease: ObservationLease): Promise<void>;
}

export class ObservationOwnershipError extends Error {}
