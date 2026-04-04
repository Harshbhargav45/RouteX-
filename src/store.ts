import {
  EventEntry,
  EventLevel,
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
  private nextEventId = 1;
  private nextRouteId = 1;
  private providerSwitchCount = 0;

  constructor(providerConfigs: ProviderConfig[], options: StoreOptions) {
    this.staleAfterMs = options.staleAfterMs;
    this.eventLogLimit = options.eventLogLimit;
    this.routeLogLimit = options.routeLogLimit;
    this.configuredMonitorMode = options.configuredMonitorMode;
    this.activeMonitorMode = options.configuredMonitorMode;

    for (const provider of providerConfigs) {
      this.providers.set(provider.name, createInitialProviderState(provider));
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
    const previous = this.listProviders().find((provider) => provider.active)?.name ?? null;

    for (const provider of this.providers.values()) {
      provider.active = provider.name === providerName;
    }

    if (previous !== providerName) {
      this.providerSwitchCount += 1;
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
    };
  }

  getMetrics() {
    const providers = this.listProviders();

    return {
      providerCount: providers.length,
      totalSuccessCount: providers.reduce((sum, provider) => sum + provider.successCount, 0),
      totalErrorCount: providers.reduce((sum, provider) => sum + provider.errorCount, 0),
      totalTimeoutCount: providers.reduce((sum, provider) => sum + provider.timeoutCount, 0),
      providerSwitchCount: this.providerSwitchCount,
      routeCount: this.routeLog.length,
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
