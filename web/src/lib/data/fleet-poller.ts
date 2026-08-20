// Framework-free snapshot poller: 12 s + jitter, re-armed setTimeout (never
// setInterval - no overlap on slow networks), exponential backoff on
// failure, `online` fast-path, last-good retention.

import { DATA_BASE, FLEET_PATH, POLL_JITTER_MS, POLL_MS } from "@/config";
import { isFleetSnapshot, type FeedState, type FleetSnapshot } from "./types";

export interface FleetUpdate {
  snapshot: FleetSnapshot | null;
  feedState: FeedState;
  lastGoodAt: number | null;
}

type Listener = (update: FleetUpdate) => void;

const BACKOFF_S = [5, 10, 20, 40, 60];
const FEED_STALE_MS = 90_000;

export interface PollerLike {
  start(): void;
  stop(): void;
  subscribe(listener: Listener): () => void;
  pollNow(): void;
}

export class FleetPoller implements PollerLike {
  private timer: number | undefined;
  private abort: AbortController | null = null;
  private failures = 0;
  private snapshot: FleetSnapshot | null = null;
  private lastGoodAt: number | null = null;
  private listeners = new Set<Listener>();
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener("online", this.onOnline);
    void this.poll();
  }

  stop(): void {
    this.running = false;
    window.removeEventListener("online", this.onOnline);
    window.clearTimeout(this.timer);
    this.abort?.abort();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.currentUpdate());
    return () => this.listeners.delete(listener);
  }

  pollNow(): void {
    if (!this.running) return;
    window.clearTimeout(this.timer);
    void this.poll();
  }

  private onOnline = () => this.pollNow();

  private currentUpdate(): FleetUpdate {
    let feedState: FeedState = "live";
    if (!this.snapshot || this.failures >= 2) {
      feedState = this.snapshot ? "down" : "down";
    } else {
      const genMs = Date.parse(this.snapshot.generated_at);
      if (Date.now() - genMs > FEED_STALE_MS) feedState = "stale";
    }
    return { snapshot: this.snapshot, feedState, lastGoodAt: this.lastGoodAt };
  }

  private notify(): void {
    const update = this.currentUpdate();
    this.listeners.forEach((l) => l(update));
  }

  private schedule(): void {
    if (!this.running) return;
    const delay =
      this.failures > 0
        ? BACKOFF_S[Math.min(this.failures - 1, BACKOFF_S.length - 1)]! * 1000
        : POLL_MS + Math.random() * POLL_JITTER_MS;
    this.timer = window.setTimeout(() => void this.poll(), delay);
  }

  private async poll(): Promise<void> {
    this.abort?.abort();
    this.abort = new AbortController();
    const timeout = window.setTimeout(() => this.abort?.abort(), 10_000);
    try {
      // no-cache (not no-store): the browser revalidates with If-None-Match
      // and CloudFront answers 304 from the edge when unchanged.
      const res = await fetch(`${DATA_BASE}${FLEET_PATH}`, {
        cache: "no-cache",
        signal: this.abort.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      if (!isFleetSnapshot(body)) throw new Error("malformed snapshot");
      this.snapshot = body;
      // The DATA's clock, never the fetch's: during the 2026-08-19 WSDOT
      // outage the snapshot file kept serving (stale) while its contents
      // froze, and stamping fetch time here made the staleness banner
      // track the rider's page-load time - overstating freshness during
      // the exact event the banner exists for (owner caught it live).
      this.lastGoodAt = Date.parse(body.generated_at) || Date.now();
      this.failures = 0;
    } catch (err) {
      if ((err as Error).name !== "AbortError" || !this.running) this.failures += 1;
      if (process.env.NODE_ENV !== "production") console.warn("fleet poll failed:", err);
    } finally {
      window.clearTimeout(timeout);
      this.notify();
      this.schedule();
    }
  }
}
