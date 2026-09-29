import type { StyleSpecification } from "maplibre-gl";
import { mapPalette } from "./map-palette";

/** The backdrop authoring page and interactive map share the same basemap styling. */
export function createBasemapStyle(
  raw: StyleSpecification,
): StyleSpecification {
  const style = structuredClone(raw);
  for (const layer of style.layers) {
    const id = layer.id.toLowerCase();
    layer.paint ??= {};
    const paint = layer.paint as Record<string, unknown>;
    if (layer.type === "background")
      paint["background-color"] = mapPalette.background;
    if (layer.type === "fill") {
      paint["fill-color"] = id.includes("water")
        ? mapPalette.water
        : id.includes("park")
          ? mapPalette.park
          : id.includes("landcover")
            ? mapPalette.landcover
            : id.includes("building")
              ? mapPalette.building
              : mapPalette.background;
      paint["fill-opacity"] = 1;
    }
    if (layer.type === "line") {
      paint["line-color"] = id.includes("water")
        ? mapPalette.waterway
        : id.includes("boundary")
          ? mapPalette.boundary
          : mapPalette.road;
      paint["line-opacity"] = id.includes("boundary") ? 0.3 : 0.7;
    }
    if (layer.type === "symbol") {
      if (
        id.includes("poi") ||
        id.includes("housenumber") ||
        id.includes("road") ||
        id.includes("oneway") ||
        id.includes("place_city")
      ) {
        layer.layout ??= {};
        layer.layout.visibility = "none";
      } else {
        paint["text-color"] = id.includes("water")
          ? mapPalette.waterLabel
          : mapPalette.label;
        paint["text-halo-color"] = mapPalette.halo;
        paint["text-halo-width"] = 1;
      }
    }
  }
  return style;
}
