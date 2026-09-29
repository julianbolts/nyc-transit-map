import { useEffect, useRef, useState, useId } from "react";
import {
  appearance,
  mutedColor,
  headingBetween,
  unwrapHeading,
} from "./transit-style";
import { mapPalette } from "./map-palette";
import { cachedJSON } from "./client-cache";
import { createMapDiagnostics, type MapDiagnostics } from "./map-diagnostics";
import { Icon, iconMarkup } from "./icons";
import { SettingsPanel, Toggle } from "./settings-panel";
import {
  DEFAULT_SETTINGS,
  type TransitMapProps,
  type RouteMetadata,
  type TransitMapSettings,
} from "./types";
import { resolveVehicles } from "./schedule";
import type { Map as GLMap, Marker, Popup } from "maplibre-gl";
import {
  decodeNetwork,
  prepare,
  pathDistance,
  travelDistance,
  jumpCutDistance,
  along,
  position,
  type Point,
  type Vehicle,
  type Prepared,
} from "./transit-geometry";
const BOUNDS: [Point, Point] = [
  [-74.02412, 40.687087],
  [-73.923274, 40.768314],
];
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const formatTime = (time: number) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(time * 1000))
    .replace(/\s[AP]M/, "");
function scheduleHTML(v: Vehicle, now: number) {
  let next = v.stops.findIndex((s) => s.departure > now);
  if (next < 0) next = v.stops.length - 1;
  return `<section class="schedule" aria-label="Journey schedule"><header class="schedule-head"><span class="eyebrow">${v.mode === "ferry" ? "NYC FERRY" : "SUBWAY"} · ${escape(v.route)}</span><button class="close" aria-label="Close schedule">×</button><h2>To ${escape(v.headsign)}</h2><p>${v.live ? (v.gps ? "Live GPS · matched to ferry route" : "Live arrivals · estimated position") : "Scheduled journey · estimated position"}</p></header><div class="stops">${v.stops.map((s, i) => `<div class="stop ${i < next ? "past" : i === next ? "next" : ""}"><time>${formatTime(s.arrival)}</time><span class="pin"></span><div>${escape(s.name)}${i === next ? "<small>" + (now >= s.arrival ? "At station" : "Approaching") + "</small>" : ""}</div></div>`).join("")}</div></section>`;
}
export function TransitMap({
  schedules,
  liveVehicles,
  settings,
  defaultSettings,
  showSettings = true,
  onSettingsChange,
  loadFallback,
  workerUrl,
  assetBaseUrl = new URL(/* @vite-ignore */ "./assets/", import.meta.url).href,
  className = "",
  style,
}: TransitMapProps) {
  const root = useRef<HTMLElement>(null);
  const settingsId = useId();
  const [localSettings, setLocalSettings] = useState<TransitMapSettings>(
    () => ({ ...DEFAULT_SETTINGS, ...defaultSettings }),
  );
  const currentSettings = { ...localSettings, ...settings };
  const {
    allowPanning: pan,
    allowZooming: zoom,
    subwayLive: subway,
    ferryLive: ferry,
  } = currentSettings;
  const changeSetting = (key: keyof TransitMapSettings, value: boolean) => {
    const next = { ...currentSettings, [key]: value };
    setLocalSettings(next);
    onSettingsChange?.(next);
  };
  const asset = (path: string) => assetBaseUrl.replace(/\/?$/, "/") + path;
  const padding = () =>
    (root.current?.clientWidth ?? 600) < 600
      ? { top: 66, bottom: 50, left: 28, right: 28 }
      : 55;
  const schedule = schedules;
  const downloaded = new Date(
    schedules.subway.sources.subway?.downloaded ?? schedules.subway.date,
  ).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const container = useRef<HTMLDivElement>(null);
  const map = useRef<GLMap | null>(null);
  const diagnostics = useRef<MapDiagnostics | null>(null);
  const engine = useRef<any>(null);
  const popup = useRef<Popup | null>(null);
  const selected = useRef<string | null>(null);
  const entries = useRef(
    new Map<
      string,
      {
        marker: Marker;
        v: Prepared;
        previous?: number;
        displayedDistance?: number;
        jumpDistance: number;
        changed: number;
        heading?: number;
        jumpCut?: boolean;
      }
    >(),
  );
  const shapes = useRef<Record<string, Point[]>>({});
  const [routeMeta, setRouteMeta] = useState<RouteMetadata | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [geometryReady, setGeometryReady] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [mapVersion, setMapVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState({
    subway: "Loading schedules…",
    ferry: "Loading schedules…",
  });
  const [notice, setNotice] = useState("Loading transit schedules…");
  const clock = useRef(0);
  const lastPopup = useRef(0);
  const showStation = (name: string, point: Point) => {
    if (!map.current || !engine.current) return;
    popup.current?.remove();
    selected.current = null;
    popup.current = new engine.current.Popup({
      closeButton: false,
      closeOnClick: false,
      maxWidth: "330px",
      offset: 12,
      focusAfterOpen: false,
    })
      .setLngLat(point)
      .setHTML(
        `<div class="station-tooltip" role="status">${escape(name)}</div>`,
      )
      .addTo(map.current);
  };
  useEffect(() => {
    if (!loaded || !map.current || !root.current) return;
    const observer = new ResizeObserver(() => map.current?.resize());
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [loaded, mapVersion]);
  const reset = () =>
    map.current?.fitBounds(BOUNDS, { padding: padding(), duration: 700 });
  const downloadDiagnostics = () => {
    const report = diagnostics.current?.report();
    if (!report) return;
    diagnostics.current?.record("diagnostics_downloaded");
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `transit-map-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  useEffect(() => {
    let cancelled = false,
      frame = 0;
    let instance: GLMap;
    const mapEntries = entries.current;
    async function init() {
      const ml = await import("maplibre-gl");
      if (workerUrl) ml.setWorkerUrl(workerUrl);
      const style: any = structuredClone(
        await cachedJSON(asset("map/style.json"), 86400 * 30),
      );
      for (const layer of style.layers) {
        const id = layer.id.toLowerCase();
        layer.paint ??= {};
        if (layer.type === "background")
          layer.paint["background-color"] = mapPalette.background;
        if (layer.type === "fill") {
          layer.paint["fill-color"] = id.includes("water")
            ? mapPalette.water
            : id.includes("park")
              ? mapPalette.park
              : id.includes("landcover")
                ? mapPalette.landcover
                : id.includes("building")
                  ? mapPalette.building
                  : mapPalette.background;
          layer.paint["fill-opacity"] = 1;
        }
        if (layer.type === "line") {
          layer.paint["line-color"] = id.includes("water")
            ? mapPalette.waterway
            : id.includes("boundary")
              ? mapPalette.boundary
              : mapPalette.road;
          layer.paint["line-opacity"] = id.includes("boundary") ? 0.3 : 0.7;
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
            layer.paint["text-color"] = id.includes("water")
              ? mapPalette.waterLabel
              : mapPalette.label;
            layer.paint["text-halo-color"] = mapPalette.halo;
            layer.paint["text-halo-width"] = 1;
          }
        }
      }
      if (cancelled) return;
      const center: Point = [-73.986, 40.733],
        initialZoom = 11;
      try {
        instance = new ml.Map({
          container: container.current!,
          style,
          center,
          zoom: initialZoom,
          attributionControl: { compact: true },
          dragPan: false,
          scrollZoom: false,
          boxZoom: false,
          doubleClickZoom: false,
          keyboard: false,
          touchZoomRotate: false,
          dragRotate: false,
          pitchWithRotate: false,
          fadeDuration: 0,
        });
        engine.current = ml;
      } catch {
        if (!loadFallback)
          throw new Error(
            "MapLibre unavailable and no fallback renderer supplied",
          );
        const fallback = await loadFallback();
        if (cancelled) return;
        engine.current = fallback;
        instance = new fallback.Map({
          container: container.current!,
          center,
          zoom: initialZoom,
        }) as unknown as GLMap;
      }
      map.current = instance;
      diagnostics.current = createMapDiagnostics(
        instance,
        engine.current === ml ? "maplibre" : "leaflet",
        ml.getVersion(),
      );
      instance.fitBounds(BOUNDS, { padding: padding(), duration: 0 });
      setMapVersion((value) => value + 1);
      setLoaded(true);
      let switched = false;
      let loadedMap = false;
      const showMap = () => {
        if (cancelled) return;
        loadedMap = true;
        setMapVisible(true);
      };
      instance.on("load", showMap);
      if (engine.current === ml)
        instance.once("idle", () => {
          if (map.current === instance)
            diagnostics.current?.capture("initial_idle");
        });
      // A worker can fail asynchronously: fall back without leaving an empty screen.
      const fallbackTimer = setTimeout(async () => {
        if (cancelled || loadedMap || switched) return;
        switched = true;
        try {
          if (!loadFallback)
            throw new Error(
              "MapLibre unavailable and no fallback renderer supplied",
            );
          const fallback = await loadFallback();
          if (cancelled) return;
          popup.current?.remove();
          popup.current = null;
          selected.current = null;
          for (const entry of mapEntries.values()) entry.marker.remove();
          mapEntries.clear();
          const center = instance.getCenter(),
            fallbackCamera = {
              center: [center.lng, center.lat] as Point,
              zoom: instance.getZoom(),
            };
          diagnostics.current?.dispose();
          instance.remove();
          engine.current = fallback;
          instance = new fallback.Map({
            container: container.current!,
            center: fallbackCamera.center,
            zoom: fallbackCamera.zoom,
          }) as unknown as GLMap;
          map.current = instance;
          diagnostics.current = createMapDiagnostics(instance, "leaflet");
          instance.on("load", showMap);
          setMapVersion((value) => value + 1);
        } catch {
          setNotice(
            "Interactive map unavailable. The saved map is still visible.",
          );
        }
      }, 8000);
      instance.on("remove", () => clearTimeout(fallbackTimer));

      const tick = () => {
        if (cancelled) return;
        const now = Date.now() / 1000 + clock.current;
        const bounds = instance.getBounds();
        for (const [id, entry] of mapEntries) {
          const target = travelDistance(entry.v, now);
          const current = entry.displayedDistance ?? entry.previous ?? target;
          const jump = Math.abs(target - current) > entry.jumpDistance;
          if (jump) {
            entry.previous = undefined;
            entry.changed = performance.now();
          }
          const blend = Math.min(
            1,
            (performance.now() - entry.changed) / 12000,
          );
          const displayedDistance =
            entry.previous !== undefined
              ? entry.previous + (target - entry.previous) * blend
              : target;
          entry.displayedDistance = displayedDistance;
          const point = along(entry.v, displayedDistance);
          const before = along(
            entry.v,
            Math.max(entry.v.stopDist[0], displayedDistance - 0.00012),
          );
          const after = along(
            entry.v,
            Math.min(entry.v.stopDist.at(-1)!, displayedDistance + 0.00012),
          );
          const element = entry.marker.getElement();
          if (before[0] !== after[0] || before[1] !== after[1]) {
            entry.heading = unwrapHeading(
              entry.heading,
              headingBetween(before, after),
            );
            element.style.setProperty("--heading", entry.heading + "deg");
          }
          if (jump) {
            element.classList.add("jump-cut");
            entry.jumpCut = true;
          } else if (entry.jumpCut) {
            element.classList.remove("jump-cut");
            entry.jumpCut = false;
          }
          entry.marker.setLngLat(point);
          element.style.display =
            bounds.contains(point) && now <= entry.v.stops.at(-1)!.departure
              ? "flex"
              : "none";
          element.classList.toggle("selected", id === selected.current);
          if (id === selected.current && popup.current) {
            popup.current.setLngLat(point);
            if (now - lastPopup.current > 10) {
              const scroll =
                popup.current!.getElement().querySelector(".stops")
                  ?.scrollTop ?? 0;
              popup.current.setHTML(scheduleHTML(entry.v, now));
              const el = popup.current!.getElement();
              el.querySelector(".close")?.addEventListener("click", () => {
                popup.current?.remove();
                selected.current = null;
              });
              const list = el.querySelector(".stops");
              if (list) list.scrollTop = scroll;
              lastPopup.current = now;
            }
          }
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    init().catch((error) => {
      if (cancelled) return;
      console.error("Map initialization", error);
      setNotice("The map could not load. Check your connection and reload.");
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (instance) {
        popup.current?.remove();
        popup.current = null;
        selected.current = null;
        for (const entry of mapEntries.values()) entry.marker.remove();
        mapEntries.clear();
        diagnostics.current?.dispose();
        diagnostics.current = null;
        instance.remove();
        if (map.current === instance) map.current = null;
      }
    };
  }, [assetBaseUrl, loadFallback, workerUrl]);
  useEffect(() => {
    if (
      !loaded ||
      !map.current ||
      typeof map.current.refreshTiles !== "function"
    )
      return;
    const instance = map.current;
    let lastRefresh = Date.now();
    // Tile loading state cannot tell whether already-loaded WebGL pixels are still visible.
    const refresh = (trigger: string) => {
      try {
        if (Date.now() - lastRefresh < 120000) {
          if (trigger !== "background_timer")
            diagnostics.current?.record("refresh_skipped", {
              trigger,
              reason: "cooldown",
              secondsSinceLast: Math.round((Date.now() - lastRefresh) / 1000),
            });
          return;
        }
        if (
          typeof instance.isStyleLoaded === "function" &&
          instance.isStyleLoaded() !== true
        ) {
          diagnostics.current?.record("refresh_skipped", {
            trigger,
            reason: "style_not_loaded",
          });
          return;
        }
        if (typeof instance.getCanvas === "function") {
          const canvas = instance.getCanvas();
          const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
          if (gl?.isContextLost()) {
            diagnostics.current?.record("refresh_skipped", {
              trigger,
              reason: "webgl_context_lost",
            });
            return;
          }
        }
        diagnostics.current?.record("refresh_requested", {
          trigger,
          cartoSourceLoaded:
            typeof instance.isSourceLoaded === "function"
              ? instance.isSourceLoaded("carto")
              : null,
          tilesLoaded:
            typeof instance.areTilesLoaded === "function"
              ? instance.areTilesLoaded()
              : null,
        });
        instance.refreshTiles("carto");
        lastRefresh = Date.now();
      } catch (error) {
        diagnostics.current?.record("refresh_error", {
          trigger,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    const check = () => {
      if (!document.hasFocus()) refresh("background_timer");
    };
    const onBlur = () => {
      diagnostics.current?.record("window_blur");
      lastRefresh = Date.now();
    };
    const onFocus = () => {
      diagnostics.current?.capture("window_focus_before_refresh");
      refresh("focus");
    };
    const onVisibility = () => {
      if (document.hidden) {
        diagnostics.current?.record("visibility_change", { state: "hidden" });
        lastRefresh = Date.now();
      } else {
        diagnostics.current?.capture("visible_before_refresh");
        refresh("visible");
      }
    };
    const onRestore = () => {
      diagnostics.current?.record("context_restored_handler");
      lastRefresh = 0;
      instance.once("idle", () => refresh("context_restored_idle"));
    };
    const timer = setInterval(check, 30000);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    instance.on("webglcontextrestored", onRestore);
    return () => {
      clearInterval(timer);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      instance.off("webglcontextrestored", onRestore);
    };
  }, [loaded, mapVersion]);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      cachedJSON<any>(asset("data/network.json"), 86400 * 30),
      cachedJSON<RouteMetadata>(asset("data/route-meta.json"), 86400 * 30),
    ])
      .then(([network, metadata]) => {
        if (cancelled) return;
        shapes.current = decodeNetwork(network);
        setRouteMeta(metadata);
        setGeometryReady(true);
      })
      .catch(() => {
        if (!cancelled) setNotice("Routes could not load. Reload to retry.");
      });
    return () => {
      cancelled = true;
    };
  }, [assetBaseUrl]);
  useEffect(() => {
    if (!loaded || !geometryReady || !map.current) return;
    const instance = map.current;
    let cancelled = false;
    const draw = () => {
      if (cancelled) return;
      const features = Object.entries(shapes.current)
        .filter(([id]) => routeMeta?.shapes[id])
        .map(([id, coordinates]) => ({
          type: "Feature",
          properties: {
            mode: id.startsWith("ferry") ? "ferry" : "subway",
            route: routeMeta?.shapes[id]?.route ?? "",
            color: mutedColor(
              appearance(
                id.startsWith("ferry") ? "ferry" : "subway",
                routeMeta?.shapes[id]?.route ?? "",
              ).color,
            ),
          },
          geometry: { type: "LineString", coordinates },
        }));
      try {
        instance.addSource("routes", {
          type: "geojson",
          data: { type: "FeatureCollection", features } as any,
        });
        instance.addLayer({
          id: "subway-routes",
          type: "line",
          source: "routes",
          filter: ["==", ["get", "mode"], "subway"],
          paint: {
            "line-color": ["get", "color"],
            "line-width": 2.2,
            "line-opacity": 0.95,
          },
        });
        instance.addLayer({
          id: "ferry-routes",
          type: "line",
          source: "routes",
          filter: ["==", ["get", "mode"], "ferry"],
          paint: {
            "line-color": ["get", "color"],
            "line-width": 1.3,
            "line-dasharray": [2, 6],
            "line-opacity": 0.85,
          },
        });
        instance.addSource("stations", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: (routeMeta?.stations ?? []).map((station) => ({
              type: "Feature",
              properties: { name: station.name },
              geometry: {
                type: "Point",
                coordinates: [station.lng, station.lat],
              },
            })),
          } as any,
        });
        instance.addLayer({
          id: "subway-stations",
          type: "circle",
          source: "stations",
          paint: {
            "circle-color": "#ffffff",
            "circle-radius": 2.8,
            "circle-stroke-color": "#101416",
            "circle-stroke-width": 1.3,
          },
        });
      } catch (error) {
        console.error("Route layer", error);
      }
    };
    if (
      "isStyleLoaded" in instance &&
      typeof instance.isStyleLoaded === "function" &&
      !instance.isStyleLoaded()
    )
      instance.on("load", draw);
    else draw();
    return () => {
      cancelled = true;
    };
  }, [loaded, geometryReady, mapVersion, routeMeta]);
  useEffect(() => {
    if (!loaded || !routeMeta || !map.current) return;
    const markers: Marker[] = [];
    for (const terminal of routeMeta.terminals) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "ferry-terminal";
      el.setAttribute("aria-label", `${terminal.name} ferry landing`);
      el.title = `${terminal.name}: ${terminal.routes.map((route) => appearance("ferry", route).name).join(", ")}`;
      el.innerHTML = "<span>" + iconMarkup("anchor") + "</span>";
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        showStation(terminal.name, [terminal.lng, terminal.lat]);
      });
      markers.push(
        new engine.current.Marker({ element: el })
          .setLngLat([terminal.lng, terminal.lat])
          .addTo(map.current),
      );
    }
    return () => {
      for (const marker of markers) marker.remove();
    };
  }, [loaded, routeMeta, mapVersion]);
  useEffect(() => {
    if (!loaded || !routeMeta || !map.current) return;
    const instance = map.current;
    const onClick = (event: any) => {
      const target = event.originalEvent?.target;
      if (
        target instanceof Element &&
        target.closest(
          ".vehicle,.ferry-terminal,.maplibregl-popup,.leaflet-popup",
        )
      )
        return;
      const point = event.point ?? event.containerPoint;
      let nearest: (typeof routeMeta.stations)[number] | undefined;
      let distance = 12;
      if (point) {
        for (const station of routeMeta.stations) {
          const projected = instance.project([station.lng, station.lat]);
          const d = Math.hypot(projected.x - point.x, projected.y - point.y);
          if (d < distance) {
            nearest = station;
            distance = d;
          }
        }
      }
      if (nearest) showStation(nearest.name, [nearest.lng, nearest.lat]);
      else {
        popup.current?.remove();
        selected.current = null;
      }
    };
    instance.on("click", onClick);
    return () => {
      instance.off("click", onClick);
    };
  }, [loaded, routeMeta, mapVersion]);
  useEffect(() => {
    if (!loaded || !map.current) return;
    pan ? map.current.dragPan.enable() : map.current.dragPan.disable();
    if (zoom) {
      map.current.scrollZoom.enable();
      map.current.doubleClickZoom.enable();
      map.current.touchZoomRotate.enable();
      map.current.touchZoomRotate.disableRotation();
    } else {
      map.current.scrollZoom.disable();
      map.current.doubleClickZoom.disable();
      map.current.touchZoomRotate.disable();
    }
    if (pan || zoom) {
      map.current.keyboard.enable();
      if (!pan) map.current.keyboard.disable();
    } else map.current.keyboard.disable();
  }, [pan, zoom, loaded, mapVersion]);
  useEffect(() => {
    if (!loaded || !geometryReady || !schedule) return;
    let cancelled = false;
    let busy = false;
    async function update() {
      if (busy) return;
      busy = true;
      try {
        const data = resolveVehicles(schedule!, liveVehicles, {
          subway,
          ferry,
        });
        if (cancelled) return;
        clock.current = 0;
        setStatus(data.status);
        setNotice(
          data.notice ??
            (data.vehicles.length ? "" : "No scheduled journeys are active."),
        );
        const ml = engine.current;
        const ids = new Set<string>();
        for (const v of data.vehicles as Vehicle[]) {
          if (v.mode === "ferry" && ["RES", "RWS"].includes(v.route)) continue;
          if (!shapes.current[v.shape]?.length) continue;
          ids.add(v.id);
          const entry = entries.current.get(v.id);
          const prepared = prepare(v, shapes.current);
          if (entry) {
            const old = entry.marker.getLngLat();
            entry.previous = pathDistance(prepared, [old.lng, old.lat]);
            entry.displayedDistance = entry.previous;
            entry.jumpDistance = jumpCutDistance(prepared);
            entry.changed = performance.now();
            entry.v = prepared;
          } else {
            const el = document.createElement("button");
            const look = appearance(v.mode, v.route);
            el.className =
              "vehicle " + v.mode + (look.express ? " express" : "");
            el.style.setProperty("--route-color", look.color);
            el.style.setProperty("--route-text", look.text);
            el.setAttribute(
              "title",
              `${look.label}${look.express ? " express" : ""} → ${v.headsign}`,
            );
            el.setAttribute(
              "aria-label",
              `${v.mode === "ferry" ? "Ferry" : "Subway"} ${v.route} to ${v.headsign}. View schedule`,
            );
            el.innerHTML =
              '<span class="direction" aria-hidden="true"><svg viewBox="0 0 26 12"><path d="M1 11 13 1 25 11 13 7Z"/></svg></span><span class="badge-shape" aria-hidden="true"></span><span class="badge-label" aria-hidden="true">' +
              (v.mode === "ferry" ? iconMarkup("ship") : escape(look.label)) +
              "</span>";
            el.addEventListener("click", (e) => {
              e.stopPropagation();
              popup.current?.remove();
              selected.current = v.id;
              const current = entries.current.get(v.id)!;
              const p = current.marker.getLngLat();
              const now = Date.now() / 1000 + clock.current;
              popup.current = new ml.Popup({
                closeButton: false,
                closeOnClick: false,
                maxWidth: "330px",
                offset: 20,
                focusAfterOpen: false,
              })
                .setLngLat(p)
                .setHTML(scheduleHTML(current.v, now))
                .addTo(map.current!);
              popup
                .current!.getElement()
                .querySelector(".close")
                ?.addEventListener("click", () => {
                  popup.current?.remove();
                  selected.current = null;
                });
              const next = popup
                .current!.getElement()
                .querySelector(".next") as HTMLElement;
              const list = popup.current!.getElement().querySelector(".stops");
              if (next && list)
                list.scrollTop = Math.max(
                  0,
                  next.offsetTop - list.getBoundingClientRect().height / 3,
                );
              lastPopup.current = now;
            });
            const marker = new ml.Marker({ element: el })
              .setLngLat(position(prepared, Date.now() / 1000 + clock.current))
              .addTo(map.current!);
            entries.current.set(v.id, {
              v: prepared,
              marker,
              displayedDistance: travelDistance(
                prepared,
                Date.now() / 1000 + clock.current,
              ),
              jumpDistance: jumpCutDistance(prepared),
              changed: performance.now(),
            });
          }
        }
        for (const [id, entry] of entries.current)
          if (!ids.has(id)) {
            entry.marker.remove();
            entries.current.delete(id);
            if (selected.current === id) {
              popup.current?.remove();
              selected.current = null;
            }
          }
      } catch (error) {
        if (cancelled) return;
        console.error("Transit update", error);
        setStatus({
          subway: "Update unavailable",
          ferry: "Update unavailable",
        });
        setNotice("Transit update unavailable. Retrying shortly.");
      } finally {
        busy = false;
      }
    }
    update();
    const timer = setInterval(update, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    loaded,
    geometryReady,
    schedule,
    liveVehicles,
    subway,
    ferry,
    mapVersion,
  ]);
  return (
    <main
      ref={root}
      className={`nyc-transit-map ${className}`}
      style={style}
      aria-label="New York subway and ferry map"
    >
      <picture className="map-backdrop" aria-hidden="true">
        <source
          media="(max-width: 600px)"
          srcSet={asset("map/backdrop-mobile.webp")}
        />
        <img
          src={asset("map/backdrop-desktop.webp")}
          alt=""
          fetchPriority="high"
        />
      </picture>
      <div
        className="map"
        ref={container}
        style={{ opacity: mapVisible ? 1 : 0 }}
      />
      {showSettings && (
        <SettingsPanel open={open} onOpenChange={setOpen} id={settingsId}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            City in motion
          </div>
          <h2>Map settings</h2>
          <div className="setting-row">
            <label htmlFor={settingsId + "-pan"}>Allow panning</label>
            <Toggle
              id={settingsId + "-pan"}
              checked={pan}
              onChange={(value) => changeSetting("allowPanning", value)}
            />
          </div>
          <div className="setting-row">
            <label htmlFor={settingsId + "-zoom"}>Allow zooming</label>
            <Toggle
              id={settingsId + "-zoom"}
              checked={zoom}
              onChange={(value) => changeSetting("allowZooming", value)}
            />
          </div>
          <button className="reset" onClick={reset}>
            <Icon name="reset" size={12} />
            Reset view
          </button>
          <div className="divider" />
          <div className="eyebrow">Real-time data</div>
          <div className="setting-row">
            <label htmlFor={settingsId + "-subway"}>
              Subways<small>{status.subway}</small>
            </label>
            <Toggle
              id={settingsId + "-subway"}
              checked={subway}
              onChange={(value) => changeSetting("subwayLive", value)}
            />
          </div>
          <div className="setting-row">
            <label htmlFor={settingsId + "-ferry"}>
              Ferries<small>{status.ferry}</small>
            </label>
            <Toggle
              id={settingsId + "-ferry"}
              checked={ferry}
              onChange={(value) => changeSetting("ferryLive", value)}
            />
          </div>
          <p className="note">
            By default, movement follows published timetables. Live subway
            locations are estimated from arrival predictions. Ferry GPS is used
            when provided by the host.
          </p>
          <div className="divider" />
          <div className="eyebrow">Troubleshooting</div>
          <button className="reset" type="button" onClick={downloadDiagnostics}>
            Download map diagnostics
          </button>
          <p className="note">
            If the basemap disappears, download diagnostics before reloading or
            panning.
          </p>
          <div className="divider" />
          <p className="note">
            Times are in New York local time.
            <br />
            Schedules imported {downloaded}.<br />
            <a
              href="https://www.mta.info/developers"
              target="_blank"
              rel="noreferrer"
            >
              MTA
            </a>{" "}
            &amp;{" "}
            <a
              href="https://www.ferry.nyc/developer-tools/"
              target="_blank"
              rel="noreferrer"
            >
              NYC Ferry
            </a>{" "}
            ·{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              OpenStreetMap
            </a>{" "}
            /{" "}
            <a
              href="https://carto.com/attributions"
              target="_blank"
              rel="noreferrer"
            >
              CARTO
            </a>
          </p>
        </SettingsPanel>
      )}
      {notice && (
        <div role="status" className="map-status">
          {notice}
        </div>
      )}
    </main>
  );
}
