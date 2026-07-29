// One shared rAF glide engine. Self-stops when nothing is gliding - between
// polls with the whole fleet docked, zero frames are burned (ambient CPU
// discipline).

export interface Glide {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  start: number;
  duration: number;
}

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function glidePosition(glide: Glide, now: number): { lat: number; lon: number; done: boolean } {
  const t = Math.min(1, (now - glide.start) / glide.duration);
  const k = easeInOutSine(t);
  return {
    lat: glide.fromLat + (glide.toLat - glide.fromLat) * k,
    lon: glide.fromLon + (glide.toLon - glide.fromLon) * k,
    done: t >= 1,
  };
}

export class GlideLoop {
  private frame: number | undefined;
  private active = new Map<number, Glide>();

  constructor(private apply: (id: number, lat: number, lon: number) => void) {}

  set(id: number, glide: Glide): void {
    this.active.set(id, glide);
    this.ensureRunning();
  }

  cancel(id: number): void {
    this.active.delete(id);
  }

  /** Snap everything to its destination (reduced motion / visibility regain). */
  snapAll(): void {
    for (const [id, g] of this.active) this.apply(id, g.toLat, g.toLon);
    this.active.clear();
  }

  stop(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.active.clear();
  }

  get running(): boolean {
    return this.frame !== undefined;
  }

  private ensureRunning(): void {
    if (this.frame === undefined && this.active.size) {
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  private tick = (): void => {
    const now = performance.now();
    for (const [id, glide] of this.active) {
      const { lat, lon, done } = glidePosition(glide, now);
      this.apply(id, lat, lon);
      if (done) this.active.delete(id);
    }
    this.frame = this.active.size ? requestAnimationFrame(this.tick) : undefined;
  };
}
