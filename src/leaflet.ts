import type { MapRenderer } from "./types";
/** Import this entry only if you need the optional Leaflet renderer. */
export async function loadLeafletRenderer(): Promise<MapRenderer> {
  return import("./map-fallback");
}
