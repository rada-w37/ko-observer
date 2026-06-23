import {
  compareNotificationRulePriority,
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

type NotificationCandidate = {
  rule: NotificationRule;
  requestId: string;
  request: NotificationRequest;
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
      const candidates: NotificationCandidate[] = [];
      for (const rule of this.options.rules) {
        const result = evaluateNotificationRule(rule, observation);
        if (result.status !== "matched") {
          continue;
        }

        candidates.push({
          rule,
          requestId: result.requestId,
          request: result.request,
        });
      }

      if (candidates.length === 0) {
        return;
      }

      candidates.sort((firstCandidate, secondCandidate) =>
        compareNotificationRulePriority(firstCandidate.rule, secondCandidate.rule),
      );

      if (this.options.dryRun) {
        this.handleDryRunCandidates(candidates);
        return;
      }

      if (this.pendingTasks.size >= this.maxQueueSize) {
        this.skippedCount += 1;
        this.logger.warn("notification queue limit reached; candidate requests skipped");
        return;
      }

      this.enqueueCreateCandidates(candidates);
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

  private handleDryRunCandidates(candidates: NotificationCandidate[]): void {
    const candidate = this.findFirstUnseenCandidate(candidates);
    if (!candidate) {
      return;
    }

    this.seenRequestIds.add(candidate.requestId);
    this.dryRunCount += 1;
    this.logger.info(
      `notification dry-run matched requestId=${candidate.requestId} ruleId=${candidate.request.ruleId}`,
    );
  }

  private enqueueCreateCandidates(candidates: NotificationCandidate[]): void {
    let task: Promise<void>;
    task = this.createCandidateRequestSafely(candidates).finally(() => {
      this.pendingTasks.delete(task);
    });
    this.pendingTasks.add(task);
  }

  private async createCandidateRequestSafely(candidates: NotificationCandidate[]): Promise<void> {
    for (const candidate of candidates) {
      if (this.seenRequestIds.has(candidate.requestId)) {
        this.skippedCount += 1;
        continue;
      }

      this.seenRequestIds.add(candidate.requestId);
      try {
        const result = await this.options.createRequest(candidate.requestId, candidate.request);
        if (result.status === "duplicate") {
          this.duplicateCount += 1;
          continue;
        }
        this.createdCount += 1;
        return;
      } catch (error) {
        this.failedCount += 1;
        this.logger.warn(`notification request create failed: ${formatErrorMessage(error)}`);
        return;
      }
    }
  }

  private findFirstUnseenCandidate(
    candidates: NotificationCandidate[],
  ): NotificationCandidate | null {
    for (const candidate of candidates) {
      if (this.seenRequestIds.has(candidate.requestId)) {
        this.skippedCount += 1;
        continue;
      }
      return candidate;
    }
    return null;
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
