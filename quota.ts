/**
 * Command Code quota client.
 *
 * Adapted from the personal `commandcode-usage` Pi extension. Data source:
 *   GET /alpha/whoami
 *   GET /alpha/billing/credits[?orgId=<uuid>]
 *   GET /alpha/billing/subscriptions[?orgId=]
 *   GET /alpha/usage/summary[?orgId=&since=<period start>]
 *
 * Mounted usage (`monthly`) needs both halves of the pool: what is left
 * (`credits`) and what the billing period already spent (`usage/summary`).
 *
 * Auth: `Authorization: Bearer <key>`, resolved by the extension from the
 * provider registry or COMMAND_CODE_API_KEY / COMMANDCODE_API_KEY.
 */

const DEFAULT_API_BASE = "https://api.commandcode.ai";
const REQUEST_TIMEOUT_MS = 10_000;

export interface QuotaWindow {
  used: number;
  cap: number;
  resetAt: number | null;
}

export interface QuotaSnapshot {
  fiveHour: QuotaWindow | null;
  weekly: QuotaWindow | null;
  /** Billing-period spend against the whole pool (remaining + spend). */
  monthly: QuotaWindow | null;
  monthlyRemaining: number | null;
  planId: string | null;
}

const EMPTY: QuotaSnapshot = {
  fiveHour: null,
  weekly: null,
  monthly: null,
  monthlyRemaining: null,
  planId: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeResetAt(value: unknown): number | null {
  let ms: number | undefined;
  if (typeof value === "number" && Number.isFinite(value)) ms = value;
  else if (typeof value === "string" && value.trim().length > 0) {
    const trimmed = value.trim();
    ms = /^\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
  }
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return null;
  return ms >= 1e12 ? Math.round(ms) : Math.round(ms * 1000);
}

function parseWindow(value: unknown): QuotaWindow | null {
  if (!isRecord(value)) return null;
  const used = finiteNumber(value.used);
  const cap = finiteNumber(value.cap);
  if (used === undefined || cap === undefined || cap <= 0) return null;
  return { used, cap, resetAt: normalizeResetAt(value.resetAt) };
}

export function parseQuota(credits: unknown, subscription: unknown, summary?: unknown): QuotaSnapshot {
  const snapshot: QuotaSnapshot = { ...EMPTY };
  if (isRecord(credits)) {
    const limits = isRecord(credits.windowLimits) ? credits.windowLimits : undefined;
    snapshot.fiveHour = parseWindow(limits?.fiveHour);
    snapshot.weekly = parseWindow(limits?.weekly);
    if (isRecord(credits.credits)) {
      const monthly = finiteNumber(credits.credits.monthlyCredits);
      const purchased = finiteNumber(credits.credits.purchasedCredits) ?? 0;
      const free = finiteNumber(credits.credits.freeCredits) ?? 0;
      snapshot.monthlyRemaining = monthly === undefined ? null : monthly + purchased + free;
    }
  }

  let periodEnd: number | null = null;
  let hasBillingPeriod = false;
  if (isRecord(subscription) && isRecord(subscription.data)) {
    const planId = subscription.data.planId;
    snapshot.planId = typeof planId === "string" && planId.length > 0 ? planId : null;
    hasBillingPeriod = normalizeResetAt(subscription.data.currentPeriodStart) !== null;
    periodEnd = normalizeResetAt(subscription.data.currentPeriodEnd);
  }

  // The summary is requested with `since=<period start>`, so its cost is the
  // billing-period spend — the half of the pool that has already been used.
  // Without a known period the number can be lifetime spend, and a "month" bar
  // built from it would be misleading, so it is only reported as remaining.
  const spent = isRecord(summary) ? finiteNumber(summary.totalCost) : undefined;
  const remaining = snapshot.monthlyRemaining;
  if (hasBillingPeriod && spent !== undefined && remaining !== null && remaining + spent > 0) {
    snapshot.monthly = { used: spent, cap: remaining + spent, resetAt: periodEnd };
  }
  return snapshot;
}

interface QuotaFetchOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type QuotaFetchResult = { ok: true; snapshot: QuotaSnapshot } | { ok: false; error: string };

function isHttpError(value: unknown): value is { status: number; body: string } {
  return isRecord(value) && typeof value.status === "number" && typeof value.body === "string";
}

export async function fetchQuotaSnapshot(options: QuotaFetchOptions): Promise<QuotaFetchResult> {
  const baseUrl = options.baseUrl ?? DEFAULT_API_BASE;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Bodies are never surfaced: they can echo credentials or account data. Only
  // the HTTP status is reported.
  const request = async (path: string): Promise<unknown> => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "GET",
      headers: { accept: "application/json", Authorization: `Bearer ${options.apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.text().catch(() => "");
      return { status: response.status, body: "" };
    }
    return response.json();
  };

  try {
    let query = "";
    const whoami = await request("/alpha/whoami").catch(() => null);
    if (isHttpError(whoami)) return { ok: false, error: `whoami rejected (${whoami.status})` };
    const orgId = isRecord(whoami) && isRecord(whoami.org) ? whoami.org.id : undefined;
    if (typeof orgId === "string" && orgId.length > 0) query = `?orgId=${encodeURIComponent(orgId)}`;

    const [credits, subscription] = await Promise.all([
      request(`/alpha/billing/credits${query}`).catch(() => null),
      request(`/alpha/billing/subscriptions${query}`).catch(() => null),
    ]);
    for (const [name, value] of [
      ["credits", credits],
      ["subscriptions", subscription],
    ] as const) {
      if (isHttpError(value) && (value.status === 401 || value.status === 403)) {
        return { ok: false, error: `${name} rejected (${value.status})` };
      }
    }

    // Only the billing period matters: a lifetime summary cannot fill a month bar.
    const periodStart = isRecord(subscription) && isRecord(subscription.data)
      ? subscription.data.currentPeriodStart
      : undefined;
    const since = typeof periodStart === "number"
      ? String(periodStart)
      : typeof periodStart === "string" && periodStart.length > 0
        ? periodStart
        : undefined;
    let summaryQuery = query;
    if (since) {
      summaryQuery = `${query ? `${query}&` : "?"}since=${encodeURIComponent(since)}`;
    }
    const summary = since ? await request(`/alpha/usage/summary${summaryQuery}`).catch(() => null) : null;

    const snapshot = parseQuota(credits, subscription, summary);
    if (!snapshot.fiveHour && !snapshot.weekly && snapshot.monthly === null && snapshot.monthlyRemaining === null) {
      return { ok: false, error: "no usage data for this account" };
    }
    return { ok: true, snapshot };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}
