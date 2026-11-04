import { battleCastleKind, minimumFreshPartySize } from "../koo/koAttributionCandidates.js";
import { KoAccumulator } from "../koo/koAccumulator.js";
import type { KoObservationBoundary, KoPersistReason } from "../koo/koAttribution.js";
import type { BattleSubscriptionScope } from "../koo/battleScopeResolver.js";
import type { ObservationCheckpoint } from "../koo/observationRun.js";
import { parseRealtimePayload, type RealtimePayloadBytes } from "../mentemori/realtimeParser.js";
import { GVG_CASTLE_STATE } from "../mentemori/types.js";
import { resolveCastleName } from "../notifications/domain/castleName.js";
import { createFallbackBaseName, resolveDisplayGuildSides } from "../notifications/domain/notificationDomain.js";
import type { NotificationCoordinator } from "../notifications/application/notificationCoordinator.js";

export type ActiveBattleScope = Exclude<BattleSubscriptionScope, { subscriptionType: "none" }>;

const MAX_DIAGNOSTIC_DECISIONS = 128;
const LAST_CONFIRMED_PLACEMENT_WORLD_ID = 1107;

type DiagnosticDecision = { priority: boolean; details: Record<string, unknown> };

function unverifiedBattleBoundary(phase: number | undefined): KoObservationBoundary | undefined {
  if (phase === GVG_CASTLE_STATE.activeBattle) return "fallen_baseline";
  if (phase === GVG_CASTLE_STATE.activeCounterattack || phase === GVG_CASTLE_STATE.activeCounterattackSuccessful) return "counterattack_baseline";
  return undefined;
}

export class KoObservationProcessor {
  readonly accumulator;
  private readonly guildNames;
  private readonly pendingCastles = new Set<number>();
  private totalsDirty = false;
  private immediate = false;
  private processedCount = 0;
  private readonly diagnosticDecisions: DiagnosticDecision[] = [];
  private omittedDecisions = 0;
  private omittedPriorityDecisions = 0;
  private coalescedBoundaryFrames = 0;
  private readonly decisionCounts: Record<KoPersistReason | "rebased" | "before_battle" | "initial_or_unchanged", number> = {
    ko_increased: 0, ko_decreased: 0, model_mismatch: 0, guilds_changed: 0, counterattack_baseline: 0, fallen_baseline: 0,
    rebased: 0, before_battle: 0, initial_or_unchanged: 0,
  };
  private readonly fullGuildIds = new Map<string, string>();
  private readonly castlePhases = new Map<number, number>();
  private readonly placementMinimumConfirmed: boolean;

  constructor(private readonly scope: ActiveBattleScope, private readonly checkpoint: ObservationCheckpoint,
    private readonly notifications: NotificationCoordinator, private readonly runId: string,
    private readonly warn: (message: string) => void,
  ) {
    this.accumulator = new KoAccumulator(checkpoint.accumulator);
    this.guildNames = { ...checkpoint.guildNames };
    this.placementMinimumConfirmed = scope.subscriptionType === "guildBattle"
      && Number(scope.worldId) >= 1001 && Number(scope.worldId) <= LAST_CONFIRMED_PLACEMENT_WORLD_ID;
    if (scope.subscriptionType === "grandBattle") {
      for (const guild of scope.participantGuilds) {
        this.fullGuildIds.set(guild.guildId, guild.guildId);
        this.fullGuildIds.set(guild.guildId.slice(0, -3), guild.guildId);
        this.guildNames[guild.guildId] = guild.guildName;
      }
    }
  }

  beginObservationEpoch(): void {
    this.castlePhases.clear();
    this.accumulator.beginObservationEpoch();
  }

  process(payload: RealtimePayloadBytes, receivedAt: Date): { castleReceived: boolean; reconnect?: boolean } {
    const parsed = parseRealtimePayload(payload);
    const invalidMessage = parsed.messages.find((message) => message.type === "unknown");
    if (parsed.status === "error" || invalidMessage) {
      const diagnostic = { status: parsed.status, reason: parsed.status === "error" ? parsed.error.message : invalidMessage?.reason,
        payloadBytes: payload.length, offset: invalidMessage ? payload.length - invalidMessage.bytes.length : null,
        streamId: invalidMessage?.streamId ?? null };
      this.warn(`Invalid realtime payload; disconnecting before further attribution. details=${JSON.stringify(diagnostic)}`);
      return { castleReceived: false, reconnect: true };
    }
    this.ruleTick(receivedAt);
    let castleReceived = false;
    for (const message of parsed.messages) {
      if (message.type === "guild" && message.guildId && message.guildName) this.guildNames[this.guildId(message.guildId)!] = message.guildName;
      if (message.type !== "castleStatus") continue;
      castleReceived = true;
      this.processedCount += 1;
      const ownerGuildId = this.guildId(message.guildId);
      const attackerGuildId = this.guildId(message.attackerGuildId);
      const ownerGuildName = ownerGuildId ? this.guildNames[ownerGuildId] ?? null : null;
      const attackerGuildName = attackerGuildId ? this.guildNames[attackerGuildId] ?? null : null;
      const previousPhase = this.castlePhases.get(message.castleId);
      const phase = message.gvgCastleState;
      const placementMinimum = this.placementMinimumConfirmed ? minimumFreshPartySize(message.castleId) : null;
      const boundary = unverifiedBattleBoundary(phase) ?? unverifiedBattleBoundary(previousPhase);
      const result = this.accumulator.observe({ castleId: message.castleId, defenderGuildId: ownerGuildId, defenderGuildName: ownerGuildName,
        attackerGuildId, attackerGuildName, defensePartyCount: message.defensePartyCount, attackPartyCount: message.attackPartyCount,
        koCount: message.lastWinPartyKnockOutCount, observedAt: receivedAt,
        normalBattlePhase: phase === GVG_CASTLE_STATE.activeDeclared,
        boundary,
        freshPartyKoLowerBound: placementMinimum ?? 1 });
      this.castlePhases.set(message.castleId, phase);
      if (result.shouldPersistCastle) { this.pendingCastles.add(message.castleId); this.immediate ||= result.rebased || result.reasons.includes("guilds_changed"); }
      this.totalsDirty ||= result.shouldUpdateGuildTotals;
      for (const reason of result.reasons) this.decisionCounts[reason]++;
      if (result.rebased) this.decisionCounts.rebased++;
      if (result.checkpointSlot !== null && result.decision.transitions.some((transition) => transition !== "no_battle")) {
        const { previous, current } = result.decision;
        const guildsChanged = result.reasons.includes("guilds_changed");
        const boundaryChanged = boundary !== undefined && previousPhase !== phase;
        if (boundary && !boundaryChanged && !guildsChanged && !result.rebased &&
            previous?.ko === current.ko && previous.defense === current.defense && previous.attack === current.attack) {
          this.coalescedBoundaryFrames++;
        } else {
          const priority = result.shouldUpdateGuildTotals || result.rebased || guildsChanged || boundaryChanged || result.reasons.includes("model_mismatch");
          this.recordDiagnostic(priority, { castleId: message.castleId, castleKind: battleCastleKind(message.castleId),
            minimumFreshPartySize: placementMinimum, freshPartyKoLowerBound: placementMinimum ?? 1,
            previousPhase, phase, observedAt: receivedAt.toISOString(),
            defenderGuildId: ownerGuildId, attackerGuildId, rebased: result.rebased, reasons: result.reasons,
            ...result.decision, candidates: result.state.candidates });
        }
      }
      if (result.checkpointSlot === null) this.decisionCounts.before_battle++;
      else if (!result.rebased && result.reasons.length === 0) this.decisionCounts.initial_or_unchanged++;
      if (this.scope.guildId) this.notifySafely(() => this.notifications.observe({
        guildId: this.scope.guildId!, battleType: this.scope.battleType, castleId: message.castleId,
        castleName: resolveCastleName(this.scope.battleType, message.castleId) ?? createFallbackBaseName(message.castleId),
        gvgCastleState: message.gvgCastleState, ownerGuildId, ownerGuildName, attackerGuildId, attackerGuildName,
        ...resolveDisplayGuildSides({ gvgCastleState: message.gvgCastleState, ownerGuildId, ownerGuildName, attackerGuildId, attackerGuildName }),
        defenseCount: message.defensePartyCount, attackCount: message.attackPartyCount, observedAt: receivedAt,
        worldId: this.scope.worldId, ...(this.scope.blockId === null ? {} : { blockId: this.scope.blockId }), runId: this.runId,
      }));
    }
    return { castleReceived };
  }

  ruleTick(observedAt: Date): void {
    if (this.scope.guildId) this.notifySafely(() => this.notifications.observeRuleTick({
      guildId: this.scope.guildId!, battleType: this.scope.battleType, observedAt, worldId: this.scope.worldId,
      ...(this.scope.blockId === null ? {} : { blockId: this.scope.blockId }), runId: this.runId,
    }));
  }

  get needsImmediateSave(): boolean { return this.immediate; }
  get progress(): string {
    const states = this.accumulator.exportSnapshot().castleStates;
    const attributedKo = [...this.accumulator.getGuildTotals().values()].reduce((sum, total) => sum + total.totalVictimKoCount, 0);
    const pending = states.reduce(([min, max], state) => [min + Math.min(...state.candidates.map((c) => c.min[2])), max + Math.max(...state.candidates.map((c) => c.max[2]))], [0, 0]);
    const closed = states.reduce(([min, max], state) => [min + state.closedUnresolvedKo[0], max + state.closedUnresolvedKo[1]], [0, 0]);
    return `processedCastles=${this.processedCount} revision=${this.accumulator.currentRevision} attributedKo=${attributedKo} pendingKo=${pending.join("..")} closedUnresolvedKo=${closed.join("..")} decisions=${JSON.stringify(this.decisionCounts)}`;
  }

  takePublication(updatedAt: Date) {
    if (this.diagnosticDecisions.length || this.coalescedBoundaryFrames) {
      const details = this.diagnosticDecisions.map((entry) => entry.details);
      this.warn(`KO attribution revision=${this.accumulator.currentRevision} omitted=${this.omittedDecisions} omittedPriority=${this.omittedPriorityDecisions} coalescedBoundary=${this.coalescedBoundaryFrames} decisions=${JSON.stringify(details)}`);
      this.diagnosticDecisions.length = 0;
      this.omittedDecisions = 0;
      this.omittedPriorityDecisions = 0;
      this.coalescedBoundaryFrames = 0;
    }
    const publication = {
      checkpoint: { ...this.checkpoint, accumulator: this.accumulator.exportSnapshot(), guildNames: { ...this.guildNames }, updatedAt },
      castleIds: [...this.pendingCastles], publishTotals: this.totalsDirty,
    };
    this.pendingCastles.clear();
    this.totalsDirty = false;
    this.immediate = false;
    return publication;
  }

  private recordDiagnostic(priority: boolean, details: DiagnosticDecision["details"]): void {
    if (this.diagnosticDecisions.length === MAX_DIAGNOSTIC_DECISIONS) {
      this.omittedDecisions++;
      if (!priority) return;
      const replaceable = this.diagnosticDecisions.findIndex((entry) => !entry.priority);
      if (replaceable < 0) {
        this.omittedPriorityDecisions++;
        return;
      }
      this.diagnosticDecisions.splice(replaceable, 1);
    }
    this.diagnosticDecisions.push({ priority, details });
  }

  private guildId(raw: string | null): string | null {
    if (!raw) return null;
    if (this.scope.subscriptionType === "grandBattle") return this.fullGuildIds.get(raw) ?? raw;
    return raw.length >= 12 ? raw : `${raw}${String(Number(this.scope.worldId) % 1000).padStart(3, "0")}`;
  }

  private notifySafely(operation: () => void): void {
    try { operation(); } catch (error) { this.warn(`Notification observation failed: ${String(error)}`); }
  }
}
