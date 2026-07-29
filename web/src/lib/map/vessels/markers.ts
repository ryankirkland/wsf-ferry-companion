// VesselMarkerPool: DOM reuse keyed by vessel id, text updated only on
// change, one-snapshot grace before removal, glide interpolation toward
// each new fix. Stale vessels freeze at their last position - never
// plotted as live (PRD acceptance criterion), independently re-derived
// from age_s even if upstream disagrees.

import maplibregl, { type Map as MLMap, type Marker } from "maplibre-gl";
import { STALE_S } from "@/config";
import type { VesselFix, VesselState } from "@/lib/data/types";
import { asOf, soundClock } from "@/lib/time/sound-time";
import { FERRY_SVG } from "./ferry-svg";
import { GlideLoop } from "./interpolate";

const MOVING_KN = 0.5; // docked boats drift 0.1-0.4 kn with noisy headings

interface Handle {
  marker: Marker;
  el: HTMLElement;
  nameEl: HTMLElement;
  statusEl: HTMLElement;
  lastState?: VesselState;
  lastStatusText?: string;
  flip: boolean;
  lat: number;
  lon: number;
  missedSnapshots: number;
}

export interface MarkerPoolOptions {
  vesselClassName: string;
  reducedMotion: () => boolean;
  onClick?: (id: number) => void;
}

export class VesselMarkerPool {
  private handles = new Map<number, Handle>();
  private glides: GlideLoop;
  private lastSnapshotAt: number | null = null;

  constructor(
    private map: MLMap,
    private opts: MarkerPoolOptions,
  ) {
    this.glides = new GlideLoop((id, lat, lon) => {
      const h = this.handles.get(id);
      if (h) {
        h.lat = lat;
        h.lon = lon;
        h.marker.setLngLat([lon, lat]);
      }
    });
  }

  applySnapshot(vessels: VesselFix[]): void {
    const now = performance.now();
    const gap = this.lastSnapshotAt ? Math.min(now - this.lastSnapshotAt, 20_000) : 0;
    this.lastSnapshotAt = now;
    const seen = new Set<number>();

    for (const fix of vessels) {
      seen.add(fix.id);
      const state: VesselState = fix.age_s > STALE_S ? "stale" : fix.state;
      let handle = this.handles.get(fix.id);
      if (!handle) {
        handle = this.create(fix);
        this.handles.set(fix.id, handle);
      }
      handle.missedSnapshots = 0;
      this.updateState(handle, fix, state);

      if (state === "stale") {
        this.glides.cancel(fix.id); // frozen at last position, never live
        continue;
      }
      if (gap > 0 && !this.opts.reducedMotion() && state === "underway") {
        this.glides.set(fix.id, {
          fromLat: handle.lat,
          fromLon: handle.lon,
          toLat: fix.lat,
          toLon: fix.lon,
          start: now,
          duration: gap,
        });
      } else {
        this.glides.cancel(fix.id);
        handle.lat = fix.lat;
        handle.lon = fix.lon;
        handle.marker.setLngLat([fix.lon, fix.lat]);
      }
    }

    // One snapshot of grace for transient upstream omissions.
    for (const [id, handle] of this.handles) {
      if (seen.has(id)) continue;
      handle.missedSnapshots += 1;
      if (handle.missedSnapshots > 1) {
        this.glides.cancel(id);
        handle.marker.remove();
        this.handles.delete(id);
      }
    }
  }

  snapAll(): void {
    this.glides.snapAll();
  }

  destroy(): void {
    this.glides.stop();
    this.handles.forEach((h) => h.marker.remove());
    this.handles.clear();
  }

  get size(): number {
    return this.handles.size;
  }

  private create(fix: VesselFix): Handle {
    const el = document.createElement("div");
    el.className = this.opts.vesselClassName;
    el.dataset.vessel = String(fix.id);
    el.innerHTML = `${FERRY_SVG}<div class="wake"></div><div class="nm"></div><div class="st"></div>`;
    const nameEl = el.querySelector<HTMLElement>(".nm")!;
    const statusEl = el.querySelector<HTMLElement>(".st")!;
    nameEl.textContent = fix.name;

    if (this.opts.onClick) {
      el.style.pointerEvents = "auto";
      el.style.cursor = "pointer";
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        this.opts.onClick?.(fix.id);
      });
    }

    const marker = new maplibregl.Marker({ element: el, anchor: "center" })
      .setLngLat([fix.lon, fix.lat])
      .addTo(this.map);
    return { marker, el, nameEl, statusEl, flip: false, lat: fix.lat, lon: fix.lon, missedSnapshots: 0 };
  }

  private updateState(handle: Handle, fix: VesselFix, state: VesselState): void {
    if (handle.lastState !== state) {
      handle.el.classList.toggle("moving", state === "underway" && fix.speed >= MOVING_KN);
      handle.el.classList.toggle("muted", state === "yard");
      handle.el.classList.toggle("stale", state === "stale");
      handle.lastState = state;
    }

    // Flip only with real way on - docked headings are dock-orientation noise.
    if (fix.speed >= MOVING_KN) {
      const flip = fix.heading > 180; // westbound; sprite faces east
      if (flip !== handle.flip) {
        handle.flip = flip;
        handle.el.classList.toggle("flip", flip);
      }
    }

    const statusText = this.statusText(fix, state);
    if (statusText !== handle.lastStatusText) {
      handle.statusEl.textContent = statusText;
      handle.lastStatusText = statusText;
    }
  }

  private statusText(fix: VesselFix, state: VesselState): string {
    switch (state) {
      case "stale":
        return asOf(new Date(Date.now() - fix.age_s * 1000));
      case "yard":
        return "resting";
      case "docked":
        return "at dock";
      case "underway":
        return fix.eta ? `arrives ~${soundClock(new Date(fix.eta))}` : "";
    }
  }
}
