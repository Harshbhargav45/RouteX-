import {
  EventEntry,
  EventLevel,
  LagHistoryPoint,
  MonitorMode,
  MonitorSource,
  ProviderCandidateOptions,
  ProviderConfig,
  ProviderState,
  RequestAttempt,
  RouteDecision,
  RouteLogEntry,
  RouteRecord,
} from "./types.js";
import { computeProviderScore } from "./scoring.js";

type StoreOptions = {
  staleAfterMs: number;
  eventLogLimit: number;
  routeLogLimit: number;
  configuredMonitorMode: MonitorMode;
};

function createInitialProviderState(provider: ProviderConfig): ProviderState {
  return {
    name: provider.name,
    rpcUrl: provider.rpcUrl,
    rpcHeaders: provider.rpcHeaders,
    cluster: provider.cluster ?? "mainnet-beta",
    yellowstoneUrl: provider.yellowstoneUrl,
    lastKnownSlot: null,
    slotLag: null,
    avgLatencyMs: null,
    lastLatencyMs: null,
    successCount: 0,
    errorCount: 0,
    timeoutCount: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastUpdatedAt: null,
    lastHealthyAt: null,
    lastRoutedAt: null,
    healthy: false,
    active: false,
    score: null,
    writeEnabled: provider.writeEnabled !== false,
    priorityBias: provider.priorityBias ?? 0,
    tags: provider.tags ?? [],
    monitorSource: "none",
  };
}

function updateRollingLatency(previous: number | null, next: number): number {
  if (previous === null) {
    return next;
  }

  return Math.round(previous * 0.7 + next * 0.3);
}

function trimToLimit<T>(items: T[], limit: number) {
  if (items.length <= limit) {
    return;
  }

  items.splice(limit);
}

export class ProviderStore {
  private readonly providers = new Map<string, ProviderState>();
  private readonly staleAfterMs: number;
  private readonly eventLogLimit: number;
  private readonly routeLogLimit: number;
  private readonly configuredMonitorMode: MonitorMode;
  private activeMonitorMode: MonitorMode;
  private readonly events: EventEntry[] = [];
  private readonly routeLog: RouteLogEntry[] = [];
  private readonly lagHistory = new Map<string, LagHistoryPoint[]>();
  private nextEventId = 1;
  private nextRouteId = 1;
  private providerSwitchCount = 0;
  private lastActiveSwitchAt: string | null = null;
  private lastActiveSwitchMs = 0;
  private static readonly SWITCH_COOLDOWN_MS = 3_000;
  private static readonly SWITCH_SCORE_THRESHOLD = 0.5;

  constructor(providerConfigs: ProviderConfig[], options: StoreOptions) {
    this.staleAfterMs = options.staleAfterMs;
    this.eventLogLimit = options.eventLogLimit;
    this.routeLogLimit = options.routeLogLimit;
    this.configuredMonitorMode = options.configuredMonitorMode;
    this.activeMonitorMode = options.configuredMonitorMode;

    for (const provider of providerConfigs) {
      this.providers.set(provider.name, createInitialProviderState(provider));
      this.lagHistory.set(provider.name, []);
    }

    this.pushEvent(
      "info",
      "startup",
      `RouteX initialized with ${providerConfigs.length} configured provider(s)`,
      null,
      {
        configuredMonitorMode: this.configuredMonitorMode,
      },
    );
  }

  getProviderCount(): number {
    return this.providers.size;
  }

  setActiveMonitorMode(mode: MonitorMode, reason: string) {
    if (this.activeMonitorMode === mode) {
      return;
    }

    this.activeMonitorMode = mode;
    this.pushEvent("info", "monitor-mode", reason, null, {
      configuredMonitorMode: this.configuredMonitorMode,
      activeMonitorMode: mode,
    });
  }

  listProviders(): ProviderState[] {
    this.refreshStaleness();

    return [...this.providers.values()].sort((left, right) => {
      const leftScore = left.score ?? Number.POSITIVE_INFINITY;
      const rightScore = right.score ?? Number.POSITIVE_INFINITY;

      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }

      return left.name.localeCompare(right.name);
    });
  }

  getBestProvider(options: ProviderCandidateOptions): ProviderState | null {
    return this.getOrderedCandidates(options)[0] ?? null;
  }

  getOrderedCandidates(options: ProviderCandidateOptions): ProviderState[] {
    this.refreshStaleness();

    return this.listProviders().filter((provider) => {
      if (provider.lastKnownSlot === null || provider.score === null) {
        return false;
      }

      if (options.healthyOnly !== false && !provider.healthy) {
        return false;
      }

      if (options.strategy === "write" && !provider.writeEnabled) {
        return false;
      }

      if (
        options.maxSlotLag !== null &&
        provider.slotLag !== null &&
        provider.slotLag > options.maxSlotLag
      ) {
        return false;
      }

      return true;
    });
  }

  updateProbeSuccess(
    providerName: string,
    slot: number,
    latencyMs: number,
    source: MonitorSource,
  ) {
    const provider = this.providers.get(providerName);

    if (!provider) {
      return;
    }

    const wasHealthy = provider.healthy;
    provider.lastKnownSlot = slot;
    provider.lastLatencyMs = latencyMs;
    provider.avgLatencyMs = updateRollingLatency(provider.avgLatencyMs, latencyMs);
    provider.lastUpdatedAt = new Date().toISOString();
    provider.lastHealthyAt = provider.lastUpdatedAt;
    provider.healthy = true;
    provider.consecutiveFailures = 0;
    provider.lastError = null;
    provider.successCount += 1;
    provider.monitorSource = source;

    this.recomputeScores();

    if (!wasHealthy) {
      this.pushEvent(
        "info",
        "provider-recovered",
        `${provider.name} recovered via ${source} monitoring`,
        provider.name,
        {
          slot,
          latencyMs,
          source,
        },
      );
    }
  }

  updateProbeFailure(
    providerName: string,
    errorMessage: string,
    timeout: boolean,
    source: MonitorSource,
  ) {
    const provider = this.providers.get(providerName);

    if (!provider) {
      return;
    }

    const wasHealthy = provider.healthy;
    provider.lastUpdatedAt = new Date().toISOString();
    provider.healthy = false;
    provider.consecutiveFailures += 1;
    provider.lastError = errorMessage;
    provider.monitorSource = source;

    if (timeout) {
      provider.timeoutCount += 1;
    } else {
      provider.errorCount += 1;
    }

    this.recomputeScores();

    if (wasHealthy || provider.consecutiveFailures === 1) {
      this.pushEvent(
        timeout ? "warn" : "error",
        "provider-degraded",
        `${provider.name} probe failed: ${errorMessage}`,
        provider.name,
        {
          timeout,
          source,
        },
      );
    }
  }

  recordRequestAttempt(attempt: RequestAttempt) {
    const provider = this.providers.get(attempt.providerName);

    if (!provider) {
      return;
    }

    provider.lastLatencyMs = attempt.durationMs;
    provider.avgLatencyMs = updateRollingLatency(provider.avgLatencyMs, attempt.durationMs);
    provider.lastUpdatedAt = new Date().toISOString();
    provider.lastRoutedAt = provider.lastUpdatedAt;

    if (attempt.ok) {
      provider.successCount += 1;
      provider.healthy = true;
      provider.lastHealthyAt = provider.lastUpdatedAt;
      provider.consecutiveFailures = 0;
      provider.lastError = null;
    } else {
      provider.healthy = false;
      provider.consecutiveFailures += 1;
      provider.lastError = attempt.errorMessage;

      if (attempt.timeout) {
        provider.timeoutCount += 1;
      } else {
        provider.errorCount += 1;
      }
    }

    this.recomputeScores();
  }

  recordRoute(record: RouteRecord) {
    const routeEntry: RouteLogEntry = {
      id: this.nextRouteId,
      requestId: record.requestId,
      method: record.method,
      strategy: record.strategy,
      providerName: record.providerName,
      attemptedProviders: record.attemptedProviders,
      attempts: record.attempts,
      status: record.status,
      durationMs: record.durationMs,
      errorMessage: record.errorMessage,
      createdAt: new Date().toISOString(),
    };

    this.nextRouteId += 1;
    this.routeLog.unshift(routeEntry);
    trimToLimit(this.routeLog, this.routeLogLimit);

    if (record.status === "failed") {
      this.pushEvent(
        "warn",
        "route-failed",
        `${record.method} failed after ${record.attempts} attempt(s)`,
        record.providerName,
        {
          requestId: record.requestId,
          attemptedProviders: record.attemptedProviders,
          errorMessage: record.errorMessage,
        },
      );
    }
  }

  markActiveProvider(providerName: string | null) {
    const providers = this.listProviders();
    const previous = providers.find((provider) => provider.active)?.name ?? null;

    if (previous === providerName) {
      return;
    }

    // Suppress rapid flicker: enforce a cooldown between switches
    const now = Date.now();
    const msSinceLastSwitch = now - this.lastActiveSwitchMs;
    if (msSinceLastSwitch < ProviderStore.SWITCH_COOLDOWN_MS) {
      return;
    }

    // Apply hysteresis: only switch away from a healthy provider if the
    // new candidate is meaningfully better (score difference > threshold).
    if (previous !== null && providerName !== null) {
      const currentState = this.providers.get(previous);
      const nextState = this.providers.get(providerName);
      if (
        currentState?.healthy &&
        currentState.score !== null &&
        nextState !== undefined &&
        nextState.score !== null &&
        currentState.score - nextState.score < ProviderStore.SWITCH_SCORE_THRESHOLD
      ) {
        return;
      }
    }

    for (const provider of this.providers.values()) {
      provider.active = provider.name === providerName;
    }

    this.providerSwitchCount += 1;
    this.lastActiveSwitchAt = new Date().toISOString();
    this.lastActiveSwitchMs = now;
    this.pushEvent(
      providerName ? "info" : "warn",
      "active-provider-switch",
      providerName
        ? `Active provider switched from ${previous ?? "none"} to ${providerName}`
        : `No active provider is currently eligible`,
      providerName,
      {
        previous,
        next: providerName,
      },
    );
  }

  noteEvent(
    level: EventLevel,
    type: string,
    message: string,
    providerName: string | null,
    details?: Record<string, unknown>,
  ) {
    this.pushEvent(level, type, message, providerName, details);
  }

  listEvents(limit = 50): EventEntry[] {
    return this.events.slice(0, limit);
  }

  listRouteLog(limit = 50): RouteLogEntry[] {
    return this.routeLog.slice(0, limit);
  }

  getLagHistory(limit = 40) {
    const result: Record<string, LagHistoryPoint[]> = {};

    for (const [providerName, history] of this.lagHistory.entries()) {
      result[providerName] = history.slice(-limit);
    }

    return result;
  }

  getSnapshot() {
    const providers = this.listProviders();
    const bestProvider = providers.find((provider) => provider.active) ?? null;
    const chainTip = this.getChainTip();

    return {
      providerCount: providers.length,
      healthyProviderCount: providers.filter((provider) => provider.healthy).length,
      chainTip,
      bestProvider,
      providers,
      monitorMode: this.activeMonitorMode,
      lastActiveSwitchAt: this.lastActiveSwitchAt,
    };
  }

  getMetrics() {
    const providers = this.listProviders();
    const routeCount = this.routeLog.length;
    const successRouteCount = this.routeLog.filter(
      (route) => route.status === "success",
    ).length;
    const failedRouteCount = routeCount - successRouteCount;
    const averageDurationMs =
      routeCount === 0
        ? null
        : Math.round(
            this.routeLog.reduce((sum, route) => sum + route.durationMs, 0) /
              routeCount,
          );
    const successRate =
      routeCount === 0
        ? null
        : Number(((successRouteCount / routeCount) * 100).toFixed(1));
    const routeProviderCounts = this.routeLog.reduce<Record<string, number>>(
      (accumulator, route) => {
        const providerName = route.providerName ?? "none";
        accumulator[providerName] = (accumulator[providerName] ?? 0) + 1;
        return accumulator;
      },
      {},
    );
    const methodCountByStrategy = this.routeLog.reduce<Record<string, number>>(
      (accumulator, route) => {
        const key = route.strategy ?? "unknown";
        accumulator[key] = (accumulator[key] ?? 0) + 1;
        return accumulator;
      },
      { read: 0, "fresh-read": 0, write: 0, unknown: 0 },
    );

    return {
      providerCount: providers.length,
      totalSuccessCount: providers.reduce((sum, provider) => sum + provider.successCount, 0),
      totalErrorCount: providers.reduce((sum, provider) => sum + provider.errorCount, 0),
      totalTimeoutCount: providers.reduce((sum, provider) => sum + provider.timeoutCount, 0),
      providerSwitchCount: this.providerSwitchCount,
      routeCount,
      successRouteCount,
      failedRouteCount,
      successRate,
      averageDurationMs,
      routeProviderCounts,
      methodCountByStrategy,
      monitorMode: this.activeMonitorMode,
      providers,
    };
  }

  private getChainTip(): number | null {
    let chainTip: number | null = null;

    for (const provider of this.providers.values()) {
      if (provider.lastKnownSlot === null) {
        continue;
      }

      chainTip =
        chainTip === null
          ? provider.lastKnownSlot
          : Math.max(chainTip, provider.lastKnownSlot);
    }

    return chainTip;
  }

  private refreshStaleness() {
    const now = Date.now();

    for (const provider of this.providers.values()) {
      if (!provider.lastUpdatedAt) {
        continue;
      }

      const age = now - new Date(provider.lastUpdatedAt).getTime();

      if (age > this.staleAfterMs && provider.healthy) {
        provider.healthy = false;
        provider.lastError = "Provider health data became stale";
        this.pushEvent(
          "warn",
          "provider-stale",
          `${provider.name} has not reported health for ${age}ms`,
          provider.name,
          {
            staleAfterMs: this.staleAfterMs,
            age,
          },
        );
      }
    }

    this.recomputeScores();
  }

  private recomputeScores() {
    const chainTip = this.getChainTip();

    for (const provider of this.providers.values()) {
      if (chainTip === null || provider.lastKnownSlot === null) {
        provider.slotLag = null;
        provider.score = null;
        continue;
      }

      provider.slotLag = Math.max(0, chainTip - provider.lastKnownSlot);
      provider.score = computeProviderScore(provider);
      this.recordLagPoint(provider);
    }
  }

  private recordLagPoint(provider: ProviderState) {
    const history = this.lagHistory.get(provider.name);

    if (!history) {
      return;
    }

    const point: LagHistoryPoint = {
      createdAt: new Date().toISOString(),
      slotLag: provider.slotLag,
      score: provider.score,
      lastKnownSlot: provider.lastKnownSlot,
    };
    const previous = history[history.length - 1];

    if (
      previous &&
      previous.slotLag === point.slotLag &&
      previous.score === point.score &&
      previous.lastKnownSlot === point.lastKnownSlot
    ) {
      return;
    }

    history.push(point);

    if (history.length > 60) {
      history.splice(0, history.length - 60);
    }
  }

  private pushEvent(
    level: EventLevel,
    type: string,
    message: string,
    providerName: string | null,
    details?: Record<string, unknown>,
  ) {
    const entry: EventEntry = {
      id: this.nextEventId,
      level,
      type,
      providerName,
      message,
      createdAt: new Date().toISOString(),
      details,
    };

    this.nextEventId += 1;
    this.events.unshift(entry);
    trimToLimit(this.events, this.eventLogLimit);
  }
}

export function buildRouteDecision(
  providerStore: ProviderStore,
  options: ProviderCandidateOptions,
): RouteDecision | null {
  const provider = providerStore.getBestProvider(options);

  if (!provider) {
    return null;
  }

  return {
    provider,
    attempts: 0,
  };
}
