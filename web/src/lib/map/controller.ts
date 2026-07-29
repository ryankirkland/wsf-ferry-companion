// PaperSoundMap: the one class that owns the imperative MapLibre surface.
// React never touches maplibregl directly - see hooks/use-map-controller.

import maplibregl, { type Map as MLMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { DECLUTTER_ZOOM, FIT_PADDING, SOUND_BOUNDS } from "@/config";
import type { VesselFix } from "@/lib/data/types";
import type { Mode } from "@/lib/time/sound-time";
import { setupLayers } from "./layers";
import { PAL } from "./palettes";
import { dedupePlaceLabels, recolor } from "./recolor";
import { addTerminalMarkers } from "./terminals";
import { VesselMarkerPool } from "./vessels/markers";

export interface ControllerOptions {
  styleUrl: string;
  ambient: boolean;
  terminalClassName: string;
  vesselClassName: string;
  onVesselClick?: (id: number) => void;
}

export type ControllerEvent = "ready" | "error";

export class PaperSoundMap {
  private map: MLMap;
  private mode: Mode = "day";
  private recolorDirty = false;
  private resizeObserver: ResizeObserver;
  private resizeTimer: number | undefined;
  private terminalMarkers: Marker[] = [];
  private vesselPool: VesselMarkerPool | null = null;
  private pendingFleet: VesselFix[] | null = null;
  private reducedMotion: MediaQueryList;
  private listeners: Record<string, Set<(detail?: unknown) => void>> = {};
  private destroyed = false;
  private tileErrorTimes: number[] = [];

  constructor(container: HTMLElement, opts: ControllerOptions) {
    this.map = new maplibregl.Map({
      container,
      style: opts.styleUrl,
      center: [-122.48, 47.685],
      zoom: 10.35,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    this.map.touchZoomRotate.disableRotation();

    if (opts.ambient) {
      for (const handler of [
        this.map.dragPan,
        this.map.scrollZoom,
        this.map.doubleClickZoom,
        this.map.touchZoomRotate,
        this.map.keyboard,
        this.map.boxZoom,
      ]) {
        handler.disable();
      }
    }

    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    this.map.on("load", () => {
      try {
        setupLayers(this.map);
        const matched = dedupePlaceLabels(this.map);
        if (process.env.NODE_ENV !== "production" && matched === 0) {
          console.warn("place-label dedup matched 0 layers - style fork changed?");
        }
        this.terminalMarkers = addTerminalMarkers(this.map, opts.terminalClassName);
        this.vesselPool = new VesselMarkerPool(this.map, {
          vesselClassName: opts.vesselClassName,
          reducedMotion: () => this.reducedMotion.matches,
          onClick: opts.ambient ? undefined : opts.onVesselClick,
        });
        if (this.pendingFleet) {
          this.vesselPool.applySnapshot(this.pendingFleet);
          this.pendingFleet = null;
        }
        recolor(this.map, PAL[this.mode]);
        this.fitSound();
        this.emit("ready");
      } catch (err) {
        this.emit("error", { fatal: true, err });
      }
    });

    // ONE permanent idle listener + a dirty flag (the prototype re-registered
    // once("idle") per setMode - a leak under React). styledata also wipes
    // paints (tile settling, style reloads), so it re-arms the flag.
    this.map.on("styledata", () => {
      this.recolorDirty = true;
    });
    this.map.on("idle", () => {
      if (this.recolorDirty) {
        this.recolorDirty = false;
        recolor(this.map, PAL[this.mode]);
      }
    });

    this.map.on("error", (e) => {
      const fatal = !this.map.isStyleLoaded() && !this.map.getStyle();
      if (fatal) {
        this.emit("error", { fatal: true, err: e.error });
        return;
      }
      // Rolling 60 s window; persistent tile trouble surfaces once.
      const now = Date.now();
      this.tileErrorTimes = this.tileErrorTimes.filter((t) => now - t < 60_000);
      this.tileErrorTimes.push(now);
      if (this.tileErrorTimes.length === 8) this.emit("error", { fatal: false, err: e.error });
      if (process.env.NODE_ENV !== "production") console.warn("map error:", e.error);
    });

    this.map.on("zoom", () => {
      container.classList.toggle("z-lo", this.map.getZoom() < DECLUTTER_ZOOM);
    });

    // The canvas can be born tiny (hidden/small panel) - re-measure on
    // resize and on visibility regain.
    this.resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        this.map.resize();
        this.fitSound();
      }, 120);
    });
    this.resizeObserver.observe(container);
    document.addEventListener("visibilitychange", this.onVisibility);

    if (process.env.NODE_ENV !== "production") {
      (window as unknown as Record<string, unknown>)._psMap = this.map;
    }
  }

  private onVisibility = () => {
    if (!document.hidden && !this.destroyed) {
      this.vesselPool?.snapAll(); // rAF was suspended; resync instantly
      this.map.resize();
      this.fitSound();
    }
  };

  applySnapshot(vessels: VesselFix[]): void {
    if (this.vesselPool) this.vesselPool.applySnapshot(vessels);
    else this.pendingFleet = vessels;
  }

  fitSound(): void {
    this.map.fitBounds(SOUND_BOUNDS, { padding: FIT_PADDING, duration: 0 });
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    recolor(this.map, PAL[mode]);
    this.recolorDirty = true; // idle handler re-applies after paint churn
  }

  getMap(): MLMap {
    return this.map;
  }

  on(event: ControllerEvent, cb: (detail?: unknown) => void): () => void {
    (this.listeners[event] ??= new Set()).add(cb);
    return () => this.listeners[event]?.delete(cb);
  }

  private emit(event: ControllerEvent, detail?: unknown): void {
    this.listeners[event]?.forEach((cb) => cb(detail));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.resizeObserver.disconnect();
    window.clearTimeout(this.resizeTimer);
    this.vesselPool?.destroy();
    this.terminalMarkers.forEach((m) => m.remove());
    this.listeners = {};
    this.map.remove();
  }
}
