import { ProviderState } from "./types.js";

function toErrorRate(state: ProviderState): number {
  const total = state.successCount + state.errorCount + state.timeoutCount;

  if (total === 0) {
    return 0;
  }

  return (state.errorCount + state.timeoutCount) / total;
}

export function computeProviderScore(state: ProviderState): number | null {
  if (state.lastKnownSlot === null || state.slotLag === null) {
    return null;
  }

  const latencyPenalty =
    state.avgLatencyMs === null ? 2 : Math.max(1, state.avgLatencyMs / 120);
  const errorPenalty = toErrorRate(state) * 50;
  const timeoutPenalty = state.timeoutCount * 2;
  const failurePenalty = state.consecutiveFailures * 7;
  const healthPenalty = state.healthy ? 0 : 60;
  const biasBonus = state.priorityBias;

  return (
    state.slotLag * 12 +
    latencyPenalty +
    errorPenalty +
    timeoutPenalty +
    failurePenalty +
    healthPenalty -
    biasBonus
  );
}
