/**
 * Q20 contextMeter: how full the context of a thread is, derived as T3's web app does
 * (reference apps/web/src/lib/contextWindow.ts deriveLatestContextWindowSnapshot): the newest live report on a provider
 * turn first, else the provider thread's contextUsage. No vscode import, so it is tested.
 */
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

export interface ContextMeter { readonly usedTokens: number; readonly maxTokens: number | null; readonly percent: number | null }
type Projection = Pick<OrchestrationV2ThreadProjection, "thread" | "providerThreads" | "providerTurns">;

export function contextMeter(projection: Projection): ContextMeter | null {
  let live: { usedTokens: number; maxTokens?: number | null | undefined; updatedAt: string } | undefined;
  // Snapshots order turns by provider thread, not time; ties go to the later entry (live upserts append).
  for (const { tokenUsage } of projection.providerTurns) {
    if (tokenUsage && (!live || Date.parse(tokenUsage.updatedAt) >= Date.parse(live.updatedAt))) live = tokenUsage;
  }
  const usage = live ?? projection.providerThreads.find((thread) => thread.id === projection.thread.activeProviderThreadId)?.contextUsage;
  if (!usage) return null;
  const usedTokens = Math.max(0, usage.usedTokens);
  const maxTokens = typeof usage.maxTokens === "number" && usage.maxTokens > 0 ? usage.maxTokens : null;
  return { usedTokens, maxTokens, percent: maxTokens === null ? null : Math.min(100, (usedTokens / maxTokens) * 100) };
}

/** "62% context", or "45k tokens" when the provider gives no window size; tokens formatted as T3's formatContextWindowTokens. */
export function contextLabel({ usedTokens, percent }: ContextMeter): string {
  return percent === null ? `${formatTokens(usedTokens)} tokens` : `${Math.round(percent)}% context`;
}

export function formatTokens(value: number): string {
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 999_500) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
