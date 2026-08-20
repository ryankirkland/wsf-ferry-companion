// PaperSoundMap: the one class that owns the imperative MapLibre surface.
// React never touches maplibregl directly - see hooks/use-map-controller.

import maplibregl, { type Map as MLMap, type Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { DECLUTTER_ZOOM, FIT_PADDING, SOUND_BOUNDS } from "@/config";
import type { VesselFix } from "@/lib/data/types";
import type { Mode } from "@/lib/time/sound-time";
import { setupLayers } from "./layers";
import { PAL } from "./palettes";
import { dedupePlaceLabels, quietenPlaceLabels, recolor } from "./recolor";
import {
  addTerminalMarkers,
  LABEL_ALL_ZOOM,
  servedTerminals,
  suppressedTownNames,
} from "./terminals";
import { servedTerminalIds } from "@/lib/data/pairs-served";
import { getTerminalDims } from "@/lib/data/dims";
import { getWeather, nowRow } from "@/lib/data/weather";
import { glyphMarkup } from "@/lib/weather-glyphs";
import { vesselScaleForZoom } from "./vessels/anchor";
import { VesselMarkerPool } from "./vessels/markers";

// Below this width the expanded attribution and the boat FAB fight for
// the same bottom-left corner.

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
  private weatherTimer?: number;
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

    // MapLibre opens the compact attribution by default, laying credit
    // lines along the bottom edge. Collapse it to the "i" at every width
    // (owner's walk, 2026-08-19): the credits stay one tap away, which is
    // what compact mode is for, and the bottom edge belongs to the map.
    this.map.once("load", () => {
      container
        .querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show");
    });

    // Ambient used to disable every interaction handler ("inert wall
    // display") - the owner's walk found that surprising rather than calm
    // (2026-08-19). The map now pans and zooms everywhere; ambient keeps
    // its 24 h guarantees, and the daily reload / visibility refit still
    // recenter a wandered wall display.

    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    this.map.on("load", () => {
      try {
        setupLayers(this.map);
        const matched = quietenPlaceLabels(this.map);
        if (process.env.NODE_ENV !== "production" && matched === 0) {
          console.warn("place-label layers matched 0 - style fork changed?");
        }
        // Terminals arrive with the dim: async, so the map is interactive
        // first and a dim outage costs labels, never the map.
        void Promise.all([getTerminalDims(), servedTerminalIds()])
          .then(([dims, servedIds]) => {
            if (this.destroyed) return;
            const terminals = servedTerminals([...dims.values()], servedIds);
            this.terminalMarkers = addTerminalMarkers(
              this.map,
              opts.terminalClassName,
              terminals,
            );
            dedupePlaceLabels(this.map, suppressedTownNames(terminals));
            this.syncLabelZoom();
            // Weather chips ride the terminal markers; refreshed on the
            // contract's cadence. Weather failing to load costs chips,
            // never the map.
            void this.syncWeather();
            this.weatherTimer = window.setInterval(() => void this.syncWeather(), 10 * 60_000);
          })
          .catch(() => undefined);
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
    this.map.on("zoom", () => this.syncLabelZoom());

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

    this.map.on("zoom", () => this.syncZoomPresentation());
    this.syncZoomPresentation();

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

  /** Minor terminals name themselves only when there is room for the
   *  names; the dots never leave. */
  private syncLabelZoom(): void {
    this.map.getContainer().classList.toggle("labels-far", this.map.getZoom() < LABEL_ALL_ZOOM);
  }

  /** Vessel presentation follows the zoom: label declutter below
   *  DECLUTTER_ZOOM, and the continuous boat scale (--vm-scale, consumed
   *  by the .vm CSS) so boats grow as the rider leans in instead of
   *  shrinking against the scenery. */
  private syncZoomPresentation(): void {
    const zoom = this.map.getZoom();
    const el = this.map.getContainer();
    el.classList.toggle("z-lo", zoom < DECLUTTER_ZOOM);
    el.style.setProperty("--vm-scale", vesselScaleForZoom(zoom).toFixed(3));
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
    window.clearInterval(this.weatherTimer);
    this.vesselPool?.destroy();
    this.terminalMarkers.forEach((m) => m.remove());
    this.listeners = {};
    this.map.remove();
  }

  /** Icon + temperature beside each terminal name (owner's pick from the
   *  density options). Chips follow the label's own declutter rules via
   *  CSS; missing weather removes the chip, never fakes one. */
  private async syncWeather(): Promise<void> {
    const doc = await getWeather();
    if (this.destroyed) return;
    for (const marker of this.terminalMarkers) {
      const el = marker.getElement();
      const t = doc?.terminals[el.dataset.terminal ?? ""];
      const row = nowRow(t);
      let chip = el.querySelector<HTMLElement>(".wx");
      if (!row) {
        chip?.remove();
        continue;
      }
      if (!chip) {
        chip = document.createElement("em");
        chip.className = "wx";
        el.prepend(chip); // top of the stack: chip over name over dot
      }
      const temp = row[1] !== null ? `<b>${row[1]}°</b>` : "";
      chip.innerHTML = `${glyphMarkup(row[2], 13)}${temp}`;
    }
  }
}
