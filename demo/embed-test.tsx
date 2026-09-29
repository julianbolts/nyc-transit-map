import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  TransitMap,
  DEFAULT_SETTINGS,
  type TransitSchedules,
  type LiveVehicles,
} from "../src";
import { loadMockSchedules } from "../src/data";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "../src/styles.css";
import "maplibre-gl/dist/maplibre-gl.css";

function Harness() {
  const [schedules, setSchedules] = useState<TransitSchedules>();
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [show, setShow] = useState(true);
  const [live, setLive] = useState<LiveVehicles>();
  useEffect(() => {
    void loadMockSchedules("/").then(setSchedules);
  }, []);
  if (!schedules) return <p>Loading fixture…</p>;
  return (
    <>
      <h1>Host application</h1>
      <p className="gear" data-testid="host-sentinel">
        Outside map CSS remains unchanged
      </p>
      <button onClick={() => setShow((v) => !v)}>
        Toggle settings visibility
      </button>
      <button
        onClick={() => {
          setLive({ ferry: [] });
          setSettings({ ...settings, ferryLive: true });
        }}
      >
        Clear live ferries
      </button>
      <button
        onClick={() => {
          setLive(undefined);
          setSettings({ ...DEFAULT_SETTINGS });
        }}
      >
        Restore timetables
      </button>
      <output>{JSON.stringify(settings)}</output>
      <div style={{ display: "flex", gap: 20 }}>
        <div data-testid="first-map" style={{ width: 700, height: 692 }}>
          <TransitMap
            schedules={schedules}
            workerUrl={workerUrl}
            assetBaseUrl="/"
            settings={settings}
            onSettingsChange={setSettings}
            liveVehicles={live}
            showSettings={show}
          />
        </div>
        <div data-testid="second-map" style={{ width: 338, height: 600 }}>
          <TransitMap
            schedules={schedules}
            workerUrl={workerUrl}
            assetBaseUrl="/"
            showSettings={false}
            defaultSettings={{ allowZooming: true }}
          />
        </div>
      </div>
      <p>Host content below both maps.</p>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
