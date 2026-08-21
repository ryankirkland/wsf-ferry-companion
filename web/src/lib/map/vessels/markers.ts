// VesselMarkerPool: DOM reuse keyed by vessel id, text updated only on
// change, one-snapshot grace before removal, glide interpolation toward
// each new fix. Stale vessels freeze at their last position - never
// plotted as live (PRD acceptance criterion), independently re-derived
// from age_s even if upstream disagrees.

import maplibregl, { type Map as MLMap, type Marker } from "maplibre-gl";
import { STALE_S } from "@/config";
import type { VesselFix, VesselState } from "@/lib/data/types";
import { asOf, soundClock } from "@/lib/time/sound-time";
import { planMooredLabels } from "./cluster";
import { getTerminalDims, getVesselDims } from "@/lib/data/dims";
import { VESSEL_ANCHOR_PX } from "./anchor";
import { classIcon, classSvg, REFERENCE_FEET } from "./class-icons";
import { GlideLoop } from "./interpolate";
import { vesselHidden } from "@/lib/map/routes";

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
  /** Last known route abbrevs - lets a filter change re-apply without
   *  waiting for the next snapshot. */
  routes: string[];
}

export interface MarkerPoolOptions {
  vesselClassName: string;
  reducedMotion: () => boolean;
  onClick?: (id: number) => void;
}

interface ClassInfo {
  klass: string;
  /** Card drawing path, e.g. /assets/vessels/jumbo.png; the map derives
   *  the transparent -t variant from it. */
  drawing: string | null;
}

export class VesselMarkerPool {
  private handles = new Map<number, Handle>();
  private glides: GlideLoop;
  private lastSnapshotAt: number | null = null;
  private hiddenRoutes: ReadonlySet<string> = new Set();
  // VesselID -> class info. Dims usually resolve after the first fleet
  // snapshot, so markers born before then get retrofitted.
  private classes = new Map<number, ClassInfo>();
  private terminalNames = new Map<number, string>();

  constructor(
    private map: MLMap,
    private opts: MarkerPoolOptions,
  ) {
    void getVesselDims()
      .then((dims) => {
        dims.forEach((d) => this.classes.set(d.id, { klass: d.class, drawing: d.drawing }));
        this.handles.forEach((h, id) => {
          if (!h.el.dataset.vesselClass) this.applyClassIcon(h.el, id);
        });
      })
      .catch(() => undefined); // fallback icons are fine without dims

    // Terminal names for the "-> Seattle ~5:15" status label; until they
    // resolve the label falls back to the bare arrival time.
    void getTerminalDims()
      .then((terms) => {
        terms.forEach((t) => this.terminalNames.set(t.id, t.name));
      })
      .catch(() => undefined);

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
    const labels = planMooredLabels(vessels);

    for (const fix of vessels) {
      seen.add(fix.id);
      const state: VesselState = fix.age_s > STALE_S ? "stale" : fix.state;
      let handle = this.handles.get(fix.id);
      if (!handle) {
        handle = this.create(fix);
        this.handles.set(fix.id, handle);
      }
      handle.missedSnapshots = 0;
      this.updateState(handle, fix, state, labels.hidden.has(fix.id), labels.companions.get(fix.id) ?? 0);

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

  /** Route filter: hidden boats keep their handles (glide state, DOM
   *  reuse) and simply stop rendering - a filter toggle must not churn
   *  the pool's bookkeeping. */
  setHiddenRoutes(hidden: ReadonlySet<string>): void {
    this.hiddenRoutes = hidden;
    for (const h of this.handles.values()) {
      h.el.classList.toggle("route-off", vesselHidden(h.routes, hidden));
    }
  }

  destroy(): void {
    this.glides.stop();
    this.handles.forEach((h) => h.marker.remove());
    this.handles.clear();
  }

  get size(): number {
    return this.handles.size;
  }

  private applyClassIcon(el: HTMLElement, id: number): void {
    const info = this.classes.get(id);
    const icon = classIcon(info?.klass);
    if (info?.klass) el.dataset.vesselClass = info.klass;
    // Real relative lengths: a 460' Jumbo Mark II reads wider than a 274'
    // Kwa-di Tabil at the same zoom (VESSEL_ANCHOR_PX on the longest class).
    el.style.width = `${((VESSEL_ANCHOR_PX * icon.feet) / REFERENCE_FEET).toFixed(1)}px`;
    const slot = el.querySelector<HTMLElement>(".boat");
    if (!slot) return;
    // The transparent WSDOT drawing IS the boat (owner's call after an
    // A/B against the traced icons, 2026-08-18: the drawings' detail
    // wins). The traced svg remains the fallback for a class without a
    // mirrored drawing or a failed asset load - the map must never show
    // an empty marker.
    const transparentSrc = info?.drawing ? info.drawing.replace(/\.png$/, "-t.png") : null;
    if (transparentSrc) {
      const img = document.createElement("img");
      img.src = transparentSrc;
      img.alt = "";
      img.draggable = false;
      img.addEventListener("error", () => {
        slot.innerHTML = classSvg(icon);
      });
      slot.replaceChildren(img);
    } else {
      slot.innerHTML = classSvg(icon);
    }
  }

  private create(fix: VesselFix): Handle {
    const el = document.createElement("div");
    el.className = this.opts.vesselClassName;
    el.dataset.vessel = String(fix.id);
    // Name + status live inside a hover tip (owner's 2026-08-20 call:
    // labels on every hull read as clutter - the silhouettes carry the
    // map). Click still opens the full card; touch has no hover and goes
    // straight there.
    el.innerHTML = `<div class="boat"></div><div class="wake"></div><div class="tip"><div class="nm"></div><div class="st"></div></div>`;
    this.applyClassIcon(el, fix.id);
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
    return {
      marker,
      el,
      nameEl,
      statusEl,
      flip: false,
      lat: fix.lat,
      lon: fix.lon,
      missedSnapshots: 0,
      routes: fix.routes,
    };
  }

  private updateState(
    handle: Handle,
    fix: VesselFix,
    state: VesselState,
    labelHidden: boolean,
    companions: number,
  ): void {
    handle.el.classList.toggle("lbl-off", labelHidden);
    handle.routes = fix.routes;
    handle.el.classList.toggle("route-off", vesselHidden(fix.routes, this.hiddenRoutes));
    const nameText = companions > 0 ? `${fix.name} +${companions}` : fix.name;
    if (nameText !== handle.nameEl.textContent) handle.nameEl.textContent = nameText;

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
      case "underway": {
        if (!fix.eta) return "";
        // Name the destination (owner's walk: "arrives ~5:15" leaves the
        // rider asking WHERE); the arrow matches the run-line convention.
        const eta = soundClock(new Date(fix.eta));
        const arr = fix.arr != null ? this.terminalNames.get(fix.arr) : null;
        return arr ? `→ ${arr} ~${eta}` : `arrives ~${eta}`;
      }
    }
  }
}
