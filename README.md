# NYC Transit Map

An embeddable React map with animated NYC subway and ferry journeys. The host supplies timetables and optional live vehicles. The package contains ESM, TypeScript declarations, scoped CSS and separate static assets. React and map engines are external peers; no Next.js, server routes, database, Cloudflare runtime, UI framework or vendored engine code is included.

## Embed

Install this package alongside `react` and `maplibre-gl`. Import the styles once. Copy `node_modules/nyc-transit-map/dist/assets` into your app's public directory (for example, `public/transit`) and serve those files. Keep the asset directory structure intact. `assetBaseUrl` supports subpaths and CDN URLs.

```tsx
import { TransitMap, type TransitSchedules } from 'nyc-transit-map';
import 'nyc-transit-map/styles.css';
import 'maplibre-gl/dist/maplibre-gl.css';
// Vite bundles the worker and its internal dependencies in the host app.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export function TransitContainer({ schedules }: { schedules: TransitSchedules }) {
  return (
    <div style={{ height: 600 }}>
      <TransitMap
        schedules={schedules}
        assetBaseUrl="/transit/"
        workerUrl={workerUrl}
        showSettings={false}
        defaultSettings={{ allowPanning: true, allowZooming: true }}
      />
    </div>
  );
}
```

The map fills its container, observes container resizing and keeps its controls/popups within that area. Give the container a height. Multiple instances use independent state and unique control IDs. Importing the package does not access browser globals; mount the map in a client boundary when using an SSR framework.

## Container and mock API

The map never loads schedules or calls transit APIs. Your container owns loading, polling, authentication, errors and live feed normalization. Replace the mock loader with your own API whenever ready:

```tsx
import { useEffect, useState } from 'react';
import { TransitMap, type TransitSchedules } from 'nyc-transit-map';
import { loadMockSchedules } from 'nyc-transit-map/data';

export function MockTransitContainer() {
  const [schedules, setSchedules] = useState<TransitSchedules>();
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    async function refresh() {
      try {
        const value = await loadMockSchedules('/transit/');
        if (mounted) { setSchedules(value); setError(''); }
      } catch {
        if (mounted) setError('Schedules could not load.');
      }
    }
    void refresh();
    const timer = setInterval(refresh, 60_000);
    return () => { mounted = false; clearInterval(timer); };
  }, []);
  if (!schedules) return <p role="status">{error || 'Loading schedules…'}</p>;
  return <div style={{ height: 600 }}><TransitMap schedules={schedules} assetBaseUrl="/transit/" /></div>;
}
```

`loadMockSchedules` reads `data/subway-schedule.json` and `data/ferry-schedule.json`. It shares concurrent requests and caches for at most 60 seconds, bounded by snapshot expiry. The snapshot date and original import time remain visible; expired data is explicitly labeled instead of relabeled as today's service. The default asset URL is relative to the ESM output for direct browser imports; **set `assetBaseUrl` explicitly in bundled apps**.

The fallback files were downloaded from official MTA regular GTFS and NYC Ferry GTFS on **September 29, 2026**. They contain that day's service, previous-day trips continuing after midnight and next-day service to bridge the nightly CI refresh. Calendar exceptions, times beyond 24:00 and New York daylight-saving transitions are respected. Regular MTA GTFS can omit temporary service changes; hosts needing those can supply supplemented schedules. Sources: [MTA developer resources](https://www.mta.info/developers), [NYC Ferry developer tools](https://www.ferry.nyc/developer-tools/).

## Public types and settings

The root exports `TransitMap`, `DEFAULT_SETTINGS`, `TransitMapProps`, `TransitMapSettings`, `TransitSchedules`, `ScheduleData`, `LiveVehicles`, `Vehicle`, `Stop`, `Point`, `TransitMode`, `RouteMetadata` and `MapRenderer`.

| Prop | Behavior |
| --- | --- |
| `schedules` | Required `{ subway: ScheduleData, ferry: ScheduleData }` |
| `liveVehicles` | Optional `{ subway?: readonly Vehicle[], ferry?: readonly Vehicle[] }` |
| `showSettings` | Shows/hides the gear and settings panel; defaults to `true` |
| `defaultSettings` | Initial uncontrolled settings |
| `settings` | Controlled overrides; update these in `onSettingsChange` |
| `onSettingsChange` | Receives the complete next settings value |
| `assetBaseUrl` | Base URL containing the exported `data/` and `map/` directories |
| `workerUrl` | Host-bundled MapLibre module worker URL; use the same value across instances |
| `loadFallback` | Optional stable loader for the separately imported fallback renderer |
| `className`, `style` | Applied to the component root |

```ts
const settings: TransitMapSettings = {
  allowPanning: false,
  allowZooming: false,
  subwayLive: false,
  ferryLive: false,
};
```

All four defaults are `false`. Settings remain effective when the gear is hidden. To control them from your app:

```tsx
const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
<TransitMap schedules={schedules} settings={settings} onSettingsChange={setSettings} />;
```

`ScheduleData` uses shared timing patterns to keep JSON compact:

```ts
interface ScheduleData {
  version: string;
  date: string; // snapshot date YYYY-MM-DD
  validUntil: number; // Unix seconds
  sources: Record<string, { downloaded: string; url?: string }>;
  stops: Record<string, [name: string, longitude: number, latitude: number]>;
  routes: Record<string, [shortName: string, longName: string, mode: 'subway' | 'ferry']>;
  patterns: [stopId: string, arrivalOffset: number, departureOffset: number, sequence: number][][];
  trips: [id: string, routeId: string, headsign: string, shapeId: string, patternIndex: number, startSeconds: number, serviceBaseEpoch: number][];
}
```

Trip stop epochs are `serviceBaseEpoch + startSeconds + patternOffset`. Namespace IDs as `subway:` or `ferry:`. Shape IDs must match the exported verified network. The importer refuses unknown shapes so new agency geometry receives review before shipping.

A live `Vehicle` carries `id`, route badge code (for example `A` or `ER`), `headsign`, `mode`, `shape`, `stops`, `live` and optional `gps: [lng, lat]`. Stop arrival/departure times are Unix seconds. The host owns freshness checks, cancellations, delays and GPS matching. The map processes prop updates immediately and animates locally. Enable `subwayLive`/`ferryLive` to select the supplied live vehicles for each mode. An omitted mode falls back to its timetable independently; an explicit `[]` means no live vehicles for that mode. Stable IDs preserve animation and selection across updates.

## Optional non-WebGL renderer

To retain the Leaflet/Canvas fallback, also install `leaflet`, `@mapbox/vector-tile` and `pbf`:

```tsx
import { loadLeafletRenderer } from 'nyc-transit-map/leaflet';
import 'leaflet/dist/leaflet.css';
<TransitMap schedules={schedules} assetBaseUrl="/transit/" loadFallback={loadLeafletRenderer} />;
```

This separate entry leaves Leaflet and vector-tile decoding out of hosts that use only MapLibre. The host owns MapLibre worker packaging; no copied worker or engine files ship in the library. With Vite, import `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` and pass it as `workerUrl` (as in the first example). Other bundlers can supply an equivalent module worker URL; its dependencies must be resolvable. The mock container example should also receive/pass your configured worker URL, or configure MapLibre globally through `setWorkerUrl` before mounting. Basemap tiles/fonts remain external CARTO/OpenStreetMap requests. Attribution remains visible.

## Development and builds

```sh
npm ci
npm run dev          # static Vite demo; no server API
npm run typecheck
npm test             # data reconciliation, geometry, palettes and request caching
npm run build        # ESM + declarations + CSS + assets in dist/
npm run build:demo   # standalone static demo in demo-dist/
npm pack            # review the distributable; does not publish
```

`src/TransitMap.tsx` owns rendering; `src/schedule.ts` owns pure timetable/live reconciliation; `src/data.ts` provides the optional JSON mock loader; `demo/main.tsx` illustrates the container boundary. `public/data/network.json` contains canonical geometry with shared signed edge references and verified water clipping. The [architecture review](docs/ARCHITECTURE.md) explains the migration and boundaries; the [map view guide](docs/MAP-VIEW.md) covers the default bounds.

## GitHub Pages demo

The demo is configured to publish at [julianbolts.github.io/nyc-transit-map](https://julianbolts.github.io/nyc-transit-map/). `.github/workflows/deploy-pages.yml` builds `demo/index.html` into `demo-dist/` and deploys that directory, including the schedules and map assets copied from `public/`. It runs on pushes to `main`, manual runs on `main`, and successful runs of **Refresh schedule snapshots** on `main`. Deployment after a refresh checks out updated `main` so the newly committed snapshots are included.

The workflow gets the base path from GitHub Pages and passes it to Vite. Demo data loaders use `import.meta.env.BASE_URL`, as do the map asset URLs. Local development and ordinary demo builds continue to use `/`. To check the GitHub project path locally:

```sh
npm run build:demo -- --base=/nyc-transit-map/
npm run preview -- --base=/nyc-transit-map/
# Open http://127.0.0.1:4173/nyc-transit-map/
```

One-time GitHub web UI setup:

1. Keep the repository public for Pages on GitHub Free. Keep `main` as the default branch; the deployment workflow and nightly refresh integration target it.
2. Open [Settings → Pages](https://github.com/julianbolts/nyc-transit-map/settings/pages). Under **Build and deployment → Source**, select **GitHub Actions**. Leave **Custom domain** blank to use the default GitHub URL.
3. Under [Settings → Actions → General](https://github.com/julianbolts/nyc-transit-map/settings/actions), ensure GitHub Actions is enabled and the `actions/*` actions used by the workflows are allowed. The workflows declare their required token permissions; no personal access token or additional secret is needed.
4. If branch rules protect `main`, ensure the existing schedule refresh workflow can push its validated snapshot commits, or adapt that workflow to your branch policy. If the `github-pages` environment has deployment branch restrictions, allow `main`; required reviewers will pause each deployment for approval.
5. Merge or push these files to `main`. In **Actions → Deploy demo to GitHub Pages**, wait for the run to finish. If setup was completed after the first run failed, select **Run workflow → main → Run workflow**. The successful deployment links to the demo URL above. For an immediate schedule update, manually run **Refresh schedule snapshots** on `main`; a successful run then deploys the demo automatically.

GitHub documents [custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [why pushes made with `GITHUB_TOKEN` do not trigger another push workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow). The deployment uses `workflow_run` to follow the refresh without needing another token.

## Nightly refresh

`.github/workflows/refresh-schedules.yml` downloads official feeds nightly at 06:15 UTC (01:15 EST / 02:15 EDT), validates both feeds, runs checks/build and commits the JSON updates. It can also be triggered manually. The repository must allow GitHub Actions to write contents and push to its default branch. Branch protection may require adapting the final commit step to your repository policy. Successful refreshes on `main` automatically deploy the GitHub Pages demo. Committing data does not update installed package versions: distribute refreshed assets through your own release/CDN pipeline.

```sh
npm run refresh:schedules
# Reproduce a downloaded import:
python3 scripts/refresh-schedules.py --feed-dir /tmp --date 2026-09-29
```

The importer uses Python's standard library. It validates calendars, stop references and compatibility with the existing network before replacing files. Geometry changes stay an authoring task; `scripts/validate-water.mjs` requires downloaded z12 water tiles under `/tmp/water-tiles` and should only run when reviewing new ferry geometry.
