/* Shared canned data + tiny animation engine for the Phase B mood boards.
 *
 * Provenance: vessel names, route assignments, and status messages come from
 * the real sample api-exploration-wsdot-ferries/samples/vessels_vessellocations.json
 * (fetched 2026-07-24, ~01:00 PT - hence mostly docked). Positions are
 * re-animated as a lively daytime moment; states are kept honest (Sealth,
 * Walla Walla, Tokitae really were laid up at Eagle Harbor; Chimacum really
 * was underway to Bremerton at 16.5 kn).
 *
 * Coordinate space: all boards share a 1600x1000 viewBox so route geometry
 * and vessel motion are identical across directions; only styling differs.
 */
(function () {
  "use strict";

  // Endpoints are inset ~30px offshore of the terminal dots so vessels dwelling
  // at a dock hold just off the label instead of covering it.
  const ROUTES = {
    sea_bi: {
      label: "Seattle - Bainbridge",
      points: [[1118, 577], [1020, 545], [860, 505], [720, 480], [617, 478]],
    },
    sea_br: {
      label: "Seattle - Bremerton",
      points: [[1120, 592], [960, 690], [780, 750], [610, 790], [480, 800], [449, 797]],
    },
    ed_king: {
      label: "Edmonds - Kingston",
      points: [[1201, 193], [1040, 175], [800, 158], [579, 152]],
    },
  };

  // Terminals + landmarks in the shared space.
  const PLACES = {
    seattle: { x: 1150, y: 585, label: "Seattle" },
    bainbridge: { x: 585, y: 470, label: "Bainbridge" },
    bremerton: { x: 415, y: 795, label: "Bremerton" },
    edmonds: { x: 1235, y: 195, label: "Edmonds" },
    kingston: { x: 545, y: 150, label: "Kingston" },
    eagleHarbor: { x: 615, y: 512, label: "Eagle Harbor yard" },
  };

  // kind: underway | docked | yard. crossS = seconds per crossing, dwellS = dock pause.
  const VESSELS = [
    { name: "Tacoma",      route: "sea_bi", kind: "underway", t0: 0.18, dir: 1,  crossS: 58, dwellS: 6 },
    { name: "Wenatchee",   route: "sea_bi", kind: "underway", t0: 0.70, dir: -1, crossS: 58, dwellS: 6 },
    { name: "Chimacum",    route: "sea_br", kind: "underway", t0: 0.42, dir: 1,  crossS: 92, dwellS: 7, note: "16.5 kn in the real sample" },
    { name: "Kaleetan",    route: "sea_br", kind: "docked", at: "bremerton" },
    { name: "Puyallup",    route: "ed_king", kind: "underway", t0: 0.10, dir: -1, crossS: 74, dwellS: 6 },
    { name: "Spokane",     route: "ed_king", kind: "docked", at: "kingston" },
    { name: "Sealth",      route: null, kind: "yard", at: "eagleHarbor", msg: "Vessel #3 returns to service at 2:05 pm" },
  ];

  // Precompute arc-length tables for even speed along polylines.
  const tables = {};
  for (const [id, r] of Object.entries(ROUTES)) {
    const pts = r.points;
    const seg = [0];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      seg.push(total);
    }
    tables[id] = { seg, total };
  }

  /** Position + heading angle (deg) at t in [0,1] along a route. */
  function posAt(routeId, t) {
    const r = ROUTES[routeId], tab = tables[routeId];
    const target = Math.min(Math.max(t, 0), 1) * tab.total;
    let i = 1;
    while (i < tab.seg.length - 1 && tab.seg[i] < target) i++;
    const a = r.points[i - 1], b = r.points[i];
    const span = tab.seg[i] - tab.seg[i - 1] || 1;
    const f = (target - tab.seg[i - 1]) / span;
    return {
      x: a[0] + (b[0] - a[0]) * f,
      y: a[1] + (b[1] - a[1]) * f,
      angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI,
    };
  }

  /** t and direction for an underway vessel at time ms (ping-pong with dock dwell). */
  function tick(v, ms) {
    const cross = v.crossS * 1000, dwell = v.dwellS * 1000;
    const cycle = 2 * (cross + dwell);
    let ph = ((ms + (v.t0 + (v.dir < 0 ? 1 : 0)) * (cross + dwell)) % cycle + cycle) % cycle;
    let t, moving = true, dir;
    if (ph < cross) { t = ph / cross; dir = 1; }
    else if (ph < cross + dwell) { t = 1; dir = 1; moving = false; }
    else if (ph < 2 * cross + dwell) { t = 1 - (ph - cross - dwell) / cross; dir = -1; }
    else { t = 0; dir = -1; moving = false; }
    return { t, dir, moving };
  }

  // ---- Product-moment canned content (shared story across boards) ----
  const TRIP = {
    from: "Seattle", to: "Bainbridge Island", crossingMin: 35,
    sailings: [
      { time: "4:45 PM", vessel: "Tacoma", status: "boarding", makeIt: "walk", note: "Boarding now" },
      { time: "5:30 PM", vessel: "Wenatchee", status: "ontime", makeIt: "easy", note: "On time" },
      { time: "6:20 PM", vessel: "Tacoma", status: "late", lateMin: 12, makeIt: "easy", note: "Running 12 min behind" },
    ],
  };

  const ALERT = {
    route: "Seattle - Bainbridge",
    title: "Tacoma running 30-35 minutes behind",
    body: "The 4:45 and 5:30 departures from Colman Dock are delayed. We will update as WSF posts new estimates.",
    time: "2 min ago",
  };

  // On-time % (within 10 min), last 14 days, Seattle-Bainbridge. One rough tide day.
  const ONTIME_14D = [96, 94, 97, 91, 88, 93, 95, 72, 90, 94, 96, 97, 89, 93];

  window.WSF = { ROUTES, PLACES, VESSELS, posAt, tick, TRIP, ALERT, ONTIME_14D,
    REDUCED: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches };
})();
