/**
 * Current-session token accounting.
 *
 * Pi records `usage` on assistant messages, tool results, branch summaries and
 * compaction entries. The sidebar sums every entry it finds in the session and
 * derives the cache-hit rate from the prompt-side counters:
 *
 *   hit% = cacheRead / (input + cacheRead + cacheWrite)
 *
 * `input` is the uncached prompt, `cacheWrite` the prompt a provider had to
 * write into its cache and `cacheRead` the prompt served from cache. A session
 * without any prompt tokens has no meaningful hit rate (`null`), so callers can
 * hide the row instead of printing a fake 0%.
 */

export interface SessionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export function emptySessionUsage(): SessionUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

export function addSessionUsage(totals: SessionUsage, usage: any): void {
  if (!usage) return;
  totals.input += Number(usage.input || 0);
  totals.output += Number(usage.output || 0);
  totals.cacheRead += Number(usage.cacheRead || 0);
  totals.cacheWrite += Number(usage.cacheWrite || 0);
  totals.cost += typeof usage.cost === "number" ? usage.cost : Number(usage.cost?.total || 0);
}

/** Share of prompt tokens served from cache, 0–100, or `null` when unknown. */
export function cacheHitPercent(totals: SessionUsage): number | null {
  const prompt = totals.input + totals.cacheRead + totals.cacheWrite;
  if (prompt <= 0 || totals.cacheRead <= 0) return null;
  return Math.min(100, Math.max(0, (totals.cacheRead / prompt) * 100));
}
