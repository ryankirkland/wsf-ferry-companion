// Dev/test poller: cycles the three committed fixture frames every 12 s so
// interpolation is exercised fully offline. Same interface as FleetPoller.

import type { FleetUpdate, PollerLike } from "./fleet-poller";
import { isFleetSnapshot, type FleetSnapshot } from "./types";

export class FixturePoller implements PollerLike {
  private frames: FleetSnapshot[] = [];
  private index = 0;
  private timer: number | undefined;
  private listeners = new Set<(u: FleetUpdate) => void>();
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.load();
  }

  stop(): void {
    this.running = false;
    window.clearTimeout(this.timer);
  }

  subscribe(listener: (u: FleetUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pollNow(): void {
    this.tick();
  }

  private async load(): Promise<void> {
    const loaded = await Promise.all(
      [0, 1, 2].map(async (i) => {
        const res = await fetch(`/dev-fixtures/fleet-frame-${i}.json`);
        const body: unknown = await res.json();
        return isFleetSnapshot(body) ? body : null;
      }),
    );
    this.frames = loaded.filter((f): f is FleetSnapshot => f !== null);
    if (this.frames.length) this.tick();
  }

  private tick = (): void => {
    if (!this.running || !this.frames.length) return;
    const frame = this.frames[this.index % this.frames.length]!;
    this.index += 1;
    // Re-stamp so feed-staleness logic sees a live feed.
    const snapshot = { ...frame, generated_at: new Date().toISOString() };
    this.listeners.forEach((l) =>
      l({ snapshot, feedState: "live", lastGoodAt: Date.now() }),
    );
    this.timer = window.setTimeout(this.tick, 12_000);
  };
}
