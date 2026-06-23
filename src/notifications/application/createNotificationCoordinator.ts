import type { Firestore } from "firebase-admin/firestore";
import {
  createNotificationRequest,
  loadNotificationRules,
} from "../../firestore/notificationRepository.js";
import { logger } from "../../shared/logger.js";
import {
  AsyncNotificationCoordinator,
  NoopNotificationCoordinator,
  type NotificationCoordinator,
} from "./notificationCoordinator.js";

export type NotificationCoordinatorConfig = {
  notificationsEnabled: boolean;
  notificationsDryRun: boolean;
};

export async function createNotificationCoordinator(input: {
  firestore: Firestore;
  config: NotificationCoordinatorConfig;
  guildId: string | null;
}): Promise<NotificationCoordinator> {
  if (!input.config.notificationsEnabled) {
    return new NoopNotificationCoordinator();
  }

  if (!input.guildId) {
    logger.warn("notifications disabled because guildId is not resolved");
    return new NoopNotificationCoordinator();
  }

  try {
    const result = await loadNotificationRules(input.firestore, input.guildId);
    logger.info(
      `notification rules loaded count=${result.rules.length}` +
        ` skippedUnsupportedVersion=${result.skippedUnsupportedVersionCount}` +
        ` skippedUnsupportedGrandBattle=${result.skippedUnsupportedGrandBattleCount}` +
        ` skippedInvalidSchema=${result.skippedInvalidSchemaCount}`,
    );
    return new AsyncNotificationCoordinator({
      rules: result.rules,
      dryRun: input.config.notificationsDryRun,
      createRequest: (requestId, request) =>
        createNotificationRequest(input.firestore, requestId, request),
    });
  } catch (error) {
    logger.warn(`notifications disabled because rule loading failed: ${formatErrorMessage(error)}`);
    return new NoopNotificationCoordinator();
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
