// Terminal dot + tracked-caps label markers, side-aware so west-shore
// labels extend left over water. Pure DOM; themed by CSS vars.

import maplibregl, { type Map as MLMap, type Marker } from "maplibre-gl";
import { TERMS } from "./routes-geo";

export function addTerminalMarkers(map: MLMap, className: string): Marker[] {
  return Object.values(TERMS).map((term) => {
    const el = document.createElement("div");
    el.className = `${className}${term.soft ? " soft" : ""}${term.side === "right" ? " right" : ""}`;
    el.innerHTML = `<i></i><span>${term.label}</span>`;

    return new maplibregl.Marker({
      element: el,
      anchor: term.side === "right" ? "right" : "left",
      offset: term.side === "right" ? [-8, 0] : [8, 0],
    })
      .setLngLat(term.ll)
      .addTo(map);
  });
}
