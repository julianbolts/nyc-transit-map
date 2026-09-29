import { Map, setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import "../src/styles.css";
import { BOUNDS } from "../src/TransitMap";
import { createBasemapStyle } from "../src/basemap-style";

// Authoring-only page: capture once the DOM reports data-capture-ready="true".
// Dimensions: desktop 1440x900; mobile 390x844. No routes, vehicles or UI.
setWorkerUrl(workerUrl);
const response = await fetch("/map/style.json");
if (!response.ok) throw new Error("Basemap style could not load");
const style = createBasemapStyle((await response.json()) as StyleSpecification);
const map = new Map({
  container: "map",
  style,
  interactive: false,
  attributionControl: { compact: false },
  fadeDuration: 0,
});
const padding =
  window.innerWidth < 600 ? { top: 66, bottom: 50, left: 28, right: 28 } : 55;
map.fitBounds(BOUNDS, { padding, duration: 0 });
map.on("error", (event) => {
  document.body.dataset.captureError = String(event.error);
});
map.once("idle", () => {
  document.body.dataset.captureReady = "true";
  document.body.dataset.captureBounds = JSON.stringify(BOUNDS);
  document.body.dataset.captureZoom = String(map.getZoom());
});
