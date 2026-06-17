import {
  evaluateNotificationRule,
  type NotificationObservation,
  type NotificationRequest,
  type NotificationRule,
} from "../domain/notificationDomain.js";
import { logger as defaultLogger } from "../../shared/logger.js";

export type NotificationCoordinator = {
  observe(observation: NotificationObservation): void;
  flush(options: { timeoutMs: number }): Promise<NotificationFlushResult>;
};

export type NotificationFlushResult = {
  timedOut: boolean;
  pendingCount: number;
  createdCount: number;
  duplicateCount: number;
  dryRunCount: number;
  skippedCount: number;
  failedCount: number;
};

export type NotificationCreateRequestResult =
  | {
      status: "created";
    }
  | {
      status: "duplicate";
    };

type NotificationCoordinatorLogger = {
  info(message: string): void;
  warn(message: string): void;
};

type NotificationCoordinatorOptions = {
  rules: NotificationRule[];
  dryRun: boolean;
  createRequest: (
    requestId: string,
    request: NotificationRequest,
  ) => Promise<NotificationCreateRequestResult>;
  maxQueueSize?: number;
  logger?: NotificationCoordinatorLogger;
};

const DEFAULT_MAX_QUEUE_SIZE = 1000;

export class AsyncNotificationCoordinator implements NotificationCoordinator {
  private readonly seenRequestIds = new Set<string>();
  private readonly pendingTasks = new Set<Promise<void>>();
  private readonly maxQueueSize: number;
  private readonly logger: NotificationCoordinatorLogger;
  private createdCount = 0;
  private duplicateCount = 0;
  private dryRunCount = 0;
  private skippedCount = 0;
  private failedCount = 0;

  constructor(private readonly options: NotificationCoordinatorOptions) {
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.logger = options.logger ?? defaultLogger;
  }

  observe(observation: NotificationObservation): void {
    try {
      for (const rule of this.options.rules) {
        const result = evaluateNotificationRule(rule, observation);
        if (result.status !== "matched") {
          continue;
        }

        if (this.seenRequestIds.has(result.requestId)) {
          this.skippedCount += 1;
          continue;
        }
        this.seenRequestIds.add(result.requestId);

        if (this.options.dryRun) {
          this.dryRunCount += 1;
          this.logger.info(
            `notification dry-run matched requestId=${result.requestId} ruleId=${result.request.ruleId}`,
          );
          continue;
        }

        if (this.pendingTasks.size >= this.maxQueueSize) {
          this.skippedCount += 1;
          this.logger.warn("notification queue limit reached; request skipped");
          continue;
        }

        this.enqueueCreateRequest(result.requestId, result.request);
      }
    } catch (error) {
      this.failedCount += 1;
      this.logger.warn(`notification observe failed: ${formatErrorMessage(error)}`);
    }
  }

  async flush(options: { timeoutMs: number }): Promise<NotificationFlushResult> {
    const pendingTasks = [...this.pendingTasks];
    if (pendingTasks.length === 0) {
      return this.createFlushResult(false);
    }

    const timeout = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), options.timeoutMs);
    });
    const result = await Promise.race([
      Promise.allSettled(pendingTasks).then(() => "completed" as const),
      timeout,
    ]);

    if (result === "timeout") {
      this.logger.warn(`notification flush timed out pending=${this.pendingTasks.size}`);
      return this.createFlushResult(true);
    }

    return this.createFlushResult(false);
  }

  private enqueueCreateRequest(requestId: string, request: NotificationRequest): void {
    let task: Promise<void>;
    task = this.createRequestSafely(requestId, request).finally(() => {
      this.pendingTasks.delete(task);
    });
    this.pendingTasks.add(task);
  }

  private async createRequestSafely(
    requestId: string,
    request: NotificationRequest,
  ): Promise<void> {
    try {
      const result = await this.options.createRequest(requestId, request);
      if (result.status === "duplicate") {
        this.duplicateCount += 1;
        return;
      }
      this.createdCount += 1;
    } catch (error) {
      this.failedCount += 1;
      this.logger.warn(`notification request create failed: ${formatErrorMessage(error)}`);
    }
  }

  private createFlushResult(timedOut: boolean): NotificationFlushResult {
    return {
      timedOut,
      pendingCount: this.pendingTasks.size,
      createdCount: this.createdCount,
      duplicateCount: this.duplicateCount,
      dryRunCount: this.dryRunCount,
      skippedCount: this.skippedCount,
      failedCount: this.failedCount,
    };
  }
}

export class NoopNotificationCoordinator implements NotificationCoordinator {
  observe(_observation: NotificationObservation): void {}

  async flush(_options: { timeoutMs: number }): Promise<NotificationFlushResult> {
    return {
      timedOut: false,
      pendingCount: 0,
      createdCount: 0,
      duplicateCount: 0,
      dryRunCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
