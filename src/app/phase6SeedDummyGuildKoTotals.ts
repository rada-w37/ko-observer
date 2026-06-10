import type { Firestore } from "firebase-admin/firestore";
import type { AppConfig } from "./config.js";
import {
  clearGuildKoTotals,
  writeKoObserverRunMeta,
  writeSeedGuildKoTotals,
} from "../firestore/koObserverKoRepository.js";
import { fetchLatestLocalGvg } from "../mentemori/apiClient.js";
import type { LocalGvgLatest } from "../mentemori/types.js";
import { logger } from "../shared/logger.js";

export type Phase6SeedDummyGuildKoTotalsResult = {
  fetchedGuildCount: number;
  selectedGuildCount: number;
  clearedGuildKoTotalsCount: number;
  writtenGuildKoTotalsCount: number;
};

type Phase6SeedDummyGuildKoTotalsDependencies = {
  fetchLatestLocalGvg?: (worldId: string) => Promise<LocalGvgLatest>;
  clearGuildKoTotals?: typeof clearGuildKoTotals;
  writeKoObserverRunMeta?: typeof writeKoObserverRunMeta;
  writeSeedGuildKoTotals?: typeof writeSeedGuildKoTotals;
  now?: () => Date;
};

const DUMMY_KO_COUNTS = [12, 7, 3, 0, 5] as const;

export async function runPhase6SeedDummyGuildKoTotals(
  config: AppConfig,
  firestore: Firestore,
  dependencies: Phase6SeedDummyGuildKoTotalsDependencies = {},
): Promise<Phase6SeedDummyGuildKoTotalsResult> {
  if (!config.worldId) {
    throw new Error("KOO_WORLD_ID is required for phase6-seed-dummy-guild-ko-totals.");
  }

  const now = dependencies.now ?? (() => new Date());
  const fetchedLocalGvg = await (dependencies.fetchLatestLocalGvg ?? fetchLatestLocalGvg)(
    config.worldId,
  );
  const selectedGuilds = selectSeedGuilds(fetchedLocalGvg);
  const updatedAt = now();
  let clearedGuildKoTotalsCount = 0;

  if (config.seedClear) {
    clearedGuildKoTotalsCount = await (dependencies.clearGuildKoTotals ?? clearGuildKoTotals)(
      firestore,
    );
    logger.info(`Phase6 dummy seed cleared guildKoTotals count=${clearedGuildKoTotalsCount}`);
  } else {
    logger.info("Phase6 dummy seed skipped guildKoTotals clear");
  }

  await (dependencies.writeSeedGuildKoTotals ?? writeSeedGuildKoTotals)(
    firestore,
    createSeedGuildKoTotals(selectedGuilds, updatedAt),
  );
  await (dependencies.writeKoObserverRunMeta ?? writeKoObserverRunMeta)(firestore, updatedAt);

  const result = {
    fetchedGuildCount: Object.keys(fetchedLocalGvg.guilds).length,
    selectedGuildCount: selectedGuilds.length,
    clearedGuildKoTotalsCount,
    writtenGuildKoTotalsCount: selectedGuilds.length,
  };

  logger.info(
    `Phase6 dummy seed completed worldId=${config.worldId} selected=${result.selectedGuildCount} written=${result.writtenGuildKoTotalsCount}`,
  );
  return result;
}

function selectSeedGuilds(localGvg: LocalGvgLatest): Array<{
  guildId: string;
  guildName: string;
}> {
  const guildIds = new Set<string>();

  for (const castle of localGvg.castles) {
    if (castle.GuildId !== 0) {
      guildIds.add(castle.GuildId.toString());
    }
    if (castle.AttackerGuildId !== 0) {
      guildIds.add(castle.AttackerGuildId.toString());
    }
  }

  return [...guildIds]
    .filter((guildId) => localGvg.guilds[guildId])
    .sort((leftGuildId, rightGuildId) => Number(leftGuildId) - Number(rightGuildId))
    .slice(0, DUMMY_KO_COUNTS.length)
    .map((guildId) => ({
      guildId,
      guildName: localGvg.guilds[guildId],
    }));
}

function createSeedGuildKoTotals(
  selectedGuilds: Array<{ guildId: string; guildName: string }>,
  updatedAt: Date,
): Map<string, { guildName: string; totalVictimKoCount: number; updatedAt: Date }> {
  return new Map(
    selectedGuilds.map((guild, index) => [
      guild.guildId,
      {
        guildName: guild.guildName,
        totalVictimKoCount: DUMMY_KO_COUNTS[index],
        updatedAt,
      },
    ]),
  );
}
