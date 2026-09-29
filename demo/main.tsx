import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TransitMap, type TransitSchedules } from "../src";
import { loadLeafletRenderer } from "../src/leaflet";
import { loadMockSchedules } from "../src/data";
import "../src/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "leaflet/dist/leaflet.css";

// This is the container boundary: replace this mock utility with your own API.
function App() {
  const [schedules, setSchedules] = useState<TransitSchedules>();
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await loadMockSchedules("/");
        if (!cancelled) {
          setSchedules(data);
          setError("");
        }
      } catch {
        if (!cancelled)
          setError("Schedule files could not load. Retrying shortly.");
      }
    }
    void load();
    const timer = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return (
    <div style={{ height: "100dvh" }}>
      {schedules ? (
        <TransitMap
          schedules={schedules}
          assetBaseUrl="/"
          loadFallback={loadLeafletRenderer}
          workerUrl={workerUrl}
        />
      ) : (
        <p role="status" style={{ color: "#edf0ef", padding: 24 }}>
          {error || "Loading transit schedules…"}
        </p>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
