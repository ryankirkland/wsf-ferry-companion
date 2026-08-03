// Admin analytics fetcher (M5). Authenticated, admin-only, no public
// static fixture equivalent - so this skips the live/fixture DATA_MODE
// split every other /data/* contract in the app follows and is just a
// plain async call, guarded the same defensive way as isStatsSummary: a
// malformed payload becomes null rather than a partial render.

import { ADMIN_ANALYTICS_PATH, API_ORIGIN } from "@/config";
import { isAdminAnalyticsSummary, type AdminAnalyticsSummary } from "@/lib/analytics/types";

export class AdminAnalyticsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function fetchAdminAnalytics(
  idToken: string,
  from: string,
  to: string,
): Promise<AdminAnalyticsSummary | null> {
  const url = `${API_ORIGIN}${ADMIN_ANALYTICS_PATH}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${idToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new AdminAnalyticsError(`request failed (${res.status})`, res.status);
  }
  const body: unknown = await res.json().catch(() => null);
  return isAdminAnalyticsSummary(body) ? body : null;
}
