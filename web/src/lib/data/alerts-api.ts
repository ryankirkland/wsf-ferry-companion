// Subscription API client (M3). All JWT routes carry the Cognito ID token;
// unsubscribe is token-in-URL (RFC 8058 shape, shared with mail clients).

import { API_ORIGIN } from "@/config";

export interface Subscription {
  id: string;
  dep: number;
  arr: number;
  dep_name: string;
  arr_name: string;
  route_id: number;
  window_start: string;
  window_end: string;
  created_at: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call(path: string, idToken: string | null, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(idToken ? { authorization: idToken } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `request failed (${res.status})`, res.status);
  return body;
}

export async function listSubscriptions(idToken: string): Promise<Subscription[]> {
  const body = (await call("/v1/subscriptions", idToken)) as { subscriptions: Subscription[] };
  return body.subscriptions;
}

export async function createSubscription(
  idToken: string,
  input: { dep: number; arr: number; window_start: string; window_end: string },
): Promise<Subscription> {
  return (await call("/v1/subscriptions", idToken, {
    method: "POST",
    body: JSON.stringify(input),
  })) as Subscription;
}

export async function deleteSubscription(idToken: string, id: string): Promise<void> {
  await call(`/v1/subscriptions/${id}`, idToken, { method: "DELETE" });
}

export async function unsubscribeAll(token: string): Promise<number> {
  const body = (await call(`/v1/unsubscribe?token=${encodeURIComponent(token)}`, null, {
    method: "POST",
  })) as { removed: number };
  return body.removed;
}
