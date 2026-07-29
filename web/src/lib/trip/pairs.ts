// GENERATED from live /data/pairs/index.json by tools/fixtures/build-trip-fixture.mjs
// (a vitest drift check compares this against the pairs-index fixture).

export interface PairEntry {
  dep: number;
  arr: number;
  depName: string;
  arrName: string;
  mate: string | null;
}

export const PAIRS: Record<string, PairEntry> = {
  "anacortes-friday-harbor": { dep: 1, arr: 10, depName: "Anacortes", arrName: "Friday Harbor", mate: "friday-harbor-anacortes" },
  "anacortes-lopez-island": { dep: 1, arr: 13, depName: "Anacortes", arrName: "Lopez Island", mate: "lopez-island-anacortes" },
  "anacortes-orcas-island": { dep: 1, arr: 15, depName: "Anacortes", arrName: "Orcas Island", mate: "orcas-island-anacortes" },
  "anacortes-shaw-island": { dep: 1, arr: 18, depName: "Anacortes", arrName: "Shaw Island", mate: "shaw-island-anacortes" },
  "bainbridge-island-seattle": { dep: 3, arr: 7, depName: "Bainbridge Island", arrName: "Seattle", mate: "seattle-bainbridge-island" },
  "bremerton-seattle": { dep: 4, arr: 7, depName: "Bremerton", arrName: "Seattle", mate: "seattle-bremerton" },
  "clinton-mukilteo": { dep: 5, arr: 14, depName: "Clinton", arrName: "Mukilteo", mate: "mukilteo-clinton" },
  "coupeville-port-townsend": { dep: 11, arr: 17, depName: "Coupeville", arrName: "Port Townsend", mate: "port-townsend-coupeville" },
  "edmonds-kingston": { dep: 8, arr: 12, depName: "Edmonds", arrName: "Kingston", mate: "kingston-edmonds" },
  "fauntleroy-southworth": { dep: 9, arr: 20, depName: "Fauntleroy", arrName: "Southworth", mate: "southworth-fauntleroy" },
  "fauntleroy-vashon-island": { dep: 9, arr: 22, depName: "Fauntleroy", arrName: "Vashon Island", mate: "vashon-island-fauntleroy" },
  "friday-harbor-anacortes": { dep: 10, arr: 1, depName: "Friday Harbor", arrName: "Anacortes", mate: "anacortes-friday-harbor" },
  "friday-harbor-lopez-island": { dep: 10, arr: 13, depName: "Friday Harbor", arrName: "Lopez Island", mate: "lopez-island-friday-harbor" },
  "friday-harbor-orcas-island": { dep: 10, arr: 15, depName: "Friday Harbor", arrName: "Orcas Island", mate: "orcas-island-friday-harbor" },
  "friday-harbor-shaw-island": { dep: 10, arr: 18, depName: "Friday Harbor", arrName: "Shaw Island", mate: "shaw-island-friday-harbor" },
  "kingston-edmonds": { dep: 12, arr: 8, depName: "Kingston", arrName: "Edmonds", mate: "edmonds-kingston" },
  "lopez-island-anacortes": { dep: 13, arr: 1, depName: "Lopez Island", arrName: "Anacortes", mate: "anacortes-lopez-island" },
  "lopez-island-friday-harbor": { dep: 13, arr: 10, depName: "Lopez Island", arrName: "Friday Harbor", mate: "friday-harbor-lopez-island" },
  "lopez-island-orcas-island": { dep: 13, arr: 15, depName: "Lopez Island", arrName: "Orcas Island", mate: "orcas-island-lopez-island" },
  "lopez-island-shaw-island": { dep: 13, arr: 18, depName: "Lopez Island", arrName: "Shaw Island", mate: "shaw-island-lopez-island" },
  "mukilteo-clinton": { dep: 14, arr: 5, depName: "Mukilteo", arrName: "Clinton", mate: "clinton-mukilteo" },
  "orcas-island-anacortes": { dep: 15, arr: 1, depName: "Orcas Island", arrName: "Anacortes", mate: "anacortes-orcas-island" },
  "orcas-island-friday-harbor": { dep: 15, arr: 10, depName: "Orcas Island", arrName: "Friday Harbor", mate: "friday-harbor-orcas-island" },
  "orcas-island-lopez-island": { dep: 15, arr: 13, depName: "Orcas Island", arrName: "Lopez Island", mate: "lopez-island-orcas-island" },
  "orcas-island-shaw-island": { dep: 15, arr: 18, depName: "Orcas Island", arrName: "Shaw Island", mate: "shaw-island-orcas-island" },
  "point-defiance-tahlequah": { dep: 16, arr: 21, depName: "Point Defiance", arrName: "Tahlequah", mate: "tahlequah-point-defiance" },
  "port-townsend-coupeville": { dep: 17, arr: 11, depName: "Port Townsend", arrName: "Coupeville", mate: "coupeville-port-townsend" },
  "seattle-bainbridge-island": { dep: 7, arr: 3, depName: "Seattle", arrName: "Bainbridge Island", mate: "bainbridge-island-seattle" },
  "seattle-bremerton": { dep: 7, arr: 4, depName: "Seattle", arrName: "Bremerton", mate: "bremerton-seattle" },
  "shaw-island-anacortes": { dep: 18, arr: 1, depName: "Shaw Island", arrName: "Anacortes", mate: "anacortes-shaw-island" },
  "shaw-island-friday-harbor": { dep: 18, arr: 10, depName: "Shaw Island", arrName: "Friday Harbor", mate: "friday-harbor-shaw-island" },
  "shaw-island-lopez-island": { dep: 18, arr: 13, depName: "Shaw Island", arrName: "Lopez Island", mate: "lopez-island-shaw-island" },
  "shaw-island-orcas-island": { dep: 18, arr: 15, depName: "Shaw Island", arrName: "Orcas Island", mate: "orcas-island-shaw-island" },
  "southworth-fauntleroy": { dep: 20, arr: 9, depName: "Southworth", arrName: "Fauntleroy", mate: "fauntleroy-southworth" },
  "southworth-vashon-island": { dep: 20, arr: 22, depName: "Southworth", arrName: "Vashon Island", mate: "vashon-island-southworth" },
  "tahlequah-point-defiance": { dep: 21, arr: 16, depName: "Tahlequah", arrName: "Point Defiance", mate: "point-defiance-tahlequah" },
  "vashon-island-fauntleroy": { dep: 22, arr: 9, depName: "Vashon Island", arrName: "Fauntleroy", mate: "fauntleroy-vashon-island" },
  "vashon-island-southworth": { dep: 22, arr: 20, depName: "Vashon Island", arrName: "Southworth", mate: "southworth-vashon-island" },
};
