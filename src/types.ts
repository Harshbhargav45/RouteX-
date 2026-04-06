export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method: string;
  params?: unknown[] | Record<string, unknown>;
};

export type JsonRpcBatchRequest = JsonRpcRequest[];

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: string;
  id?: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
};

export type JsonRpcBatchResponse = JsonRpcResponse[];

export type MonitorMode = "rpc" | "yellowstone";
export type MonitorSource = "rpc" | "yellowstone" | "none";
export type MethodStrategy = "read" | "fresh-read" | "write";
export type EventLevel = "info" | "warn" | "error";

export type ProviderConfig = {
  name: string;
  rpcUrl: string;
  rpcHeaders?: Record<string, string>;
  cluster?: string;
  yellowstoneUrl?: string;
  token?: string;
  writeEnabled?: boolean;
  priorityBias?: number;
  tags?: string[];
};

export type ProviderState = {
  name: string;
  rpcUrl: string;
  rpcHeaders?: Record<string, string>;
  cluster: string;
  yellowstoneUrl?: string;
  lastKnownSlot: number | null;
  slotLag: number | null;
  avgLatencyMs: number | null;
  lastLatencyMs: number | null;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastUpdatedAt: string | null;
  lastHealthyAt: string | null;
  lastRoutedAt: string | null;
  healthy: boolean;
  active: boolean;
  score: number | null;
  writeEnabled: boolean;
  priorityBias: number;
  tags: string[];
  monitorSource: MonitorSource;
};

export type RequestAttempt = {
  providerName: string;
  durationMs: number;
  ok: boolean;
  timeout: boolean;
  errorMessage: string | null;
};

export type RouteDecision = {
  provider: ProviderState;
  attempts: number;
};

export type EventEntry = {
  id: number;
  level: EventLevel;
  type: string;
  providerName: string | null;
  message: string;
  createdAt: string;
  details?: Record<string, unknown>;
};

export type RouteLogEntry = {
  id: number;
  requestId: string;
  method: string;
  strategy: MethodStrategy;
  providerName: string | null;
  attemptedProviders: string[];
  attempts: number;
  status: "success" | "failed";
  durationMs: number;
  errorMessage: string | null;
  createdAt: string;
};

export type LagHistoryPoint = {
  createdAt: string;
  slotLag: number | null;
  score: number | null;
  lastKnownSlot: number | null;
};

export type RouteRecord = {
  requestId: string;
  method: string;
  strategy: MethodStrategy;
  providerName: string | null;
  attemptedProviders: string[];
  attempts: number;
  status: "success" | "failed";
  durationMs: number;
  errorMessage: string | null;
};

export type ProviderCandidateOptions = {
  strategy: MethodStrategy;
  maxSlotLag: number | null;
  healthyOnly?: boolean;
};

export type RouteXConfig = {
  host: string;
  port: number;
  monitorIntervalMs: number;
  requestTimeoutMs: number;
  maxSlotLagForWrites: number;
  maxSlotLagForFreshReads: number;
  staleAfterMs: number;
  routeLogLimit: number;
  eventLogLimit: number;
  monitorMode: MonitorMode;
  providers: ProviderConfig[];
};
