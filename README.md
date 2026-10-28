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

`loadMockSchedules` reads one static `data/transit-bundle.json` containing both timetables, verified geometry, and route metadata. This keeps every asset on the same revision, including after a deployment. It shares concurrent requests, revalidates at most once per minute, and reuses the last cached bundle if a request fails. The default asset URL is relative to the ESM output for direct browser imports; **set `assetBaseUrl` explicitly in bundled apps**.

The demo uses **typical weekly timetables**, refreshed monthly from official MTA regular GTFS and NYC Ferry GTFS. The browser selects the New York weekday and places relative trip times onto that service date. Equivalent weekdays share templates; Saturday, Sunday, and other weekday differences remain separate when present. Known seasonal changes are kept when their geometry is verified. Holidays follow their ordinary weekday. Overnight journeys, times beyond 24:00, and New York daylight-saving transitions are supported.

Templates keep animating beyond the feed's date coverage and after a missed refresh. The settings panel shows each mode's original import date; older templates receive a small status label, without an expired-schedule error or an empty map. These are representative animated journeys, not a trip-planning service. Regular MTA GTFS can omit temporary service changes; hosts needing those can supply current dated schedules or live vehicles. Sources: [MTA developer resources](https://www.mta.info/developers), [NYC Ferry developer tools](https://www.ferry.nyc/developer-tools/).

## Public types and settings

The root exports `TransitMap`, `DEFAULT_SETTINGS`, `TransitMapProps`, `TransitMapSettings`, `TransitSchedules`, `ScheduleData`, `DatedScheduleData`, `WeeklyScheduleData`, `WeekVariants`, `LiveVehicles`, `Vehicle`, `Stop`, `Point`, `TransitMode`, `RouteMetadata` and `MapRenderer`.

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

`ScheduleData` accepts both recurring `WeeklyScheduleData` and the original `DatedScheduleData`. Both use shared stop dictionaries and relative timing patterns to keep JSON compact. Dated schedules retain their absolute service epochs and expiry; existing host-supplied snapshots continue to work.

The recurring format has `kind: 'weekly-template'`, `schemaVersion: 2`, `timezone: 'America/New_York'`, `generatedAt`, `refreshAfter`, and original source metadata. Its main fields are:

```ts
// Trips have no saved date or absolute epoch.
trips: [id: string, routeId: string, headsign: string, canonicalShapeId: string,
        patternIndex: number, startSeconds: number][];
patterns: [stopId: string, arrivalOffset: number, departureOffset: number, sequence: number][][];
variants: Record<string, number[]>; // indices into trips
// Monday through Sunday; repeated IDs share the same template.
fallbackWeek: [string, string, string, string, string, string, string];
periods: { from: string; through: string; week: WeekVariants }[];
```

An effective period overrides the fallback week for its date range. Empty variants mean no service. Outside covered periods, the last usable typical week repeats indefinitely. `refreshAfter` is a freshness hint, not an expiry deadline. The live-data controls keep the same precedence for both schedule formats.

Namespace IDs as `subway:` or `ferry:`. Trip stop epochs are computed from the chosen New York service base plus start seconds and pattern offsets. Shapes resolve to the exported verified network using `public/data/geometry-sources.json`: fingerprints cover source geometry, route, and ordered stop locations. An equivalent renamed shape can reuse its canonical path; a changed path or terminal requires geometry review even when its upstream ID stays the same.

The mock loader supplies optional `schedules.assets` with the matching network and metadata from the same bundle. Custom containers can omit this and serve `data/network.json` and `data/route-meta.json` through `assetBaseUrl` as before.

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

The demo is configured to publish at [julianbolts.github.io/nyc-transit-map](https://julianbolts.github.io/nyc-transit-map/). `.github/workflows/deploy-pages.yml` builds `demo/index.html` into `demo-dist/` and deploys that directory, including the schedules and map assets copied from `public/`. It runs on pushes to `main`, manual runs on `main`, and successful runs of **Refresh schedule snapshots** on `main`. Deployment after a refresh checks out updated `main` so the newly committed templates are included.

The workflow gets the base path from GitHub Pages and passes it to Vite. Demo data loaders use `import.meta.env.BASE_URL`, as do the map asset URLs. Local development and ordinary demo builds continue to use `/`. To check the GitHub project path locally:

```sh
npm run build:demo -- --base=/nyc-transit-map/
npm run preview -- --base=/nyc-transit-map/
# Open http://127.0.0.1:4173/nyc-transit-map/
```

One-time GitHub web UI setup:

1. Keep the repository public for Pages on GitHub Free. Keep `main` as the default branch; the deployment workflow and monthly refresh integration target it.
2. Open [Settings → Pages](https://github.com/julianbolts/nyc-transit-map/settings/pages). Under **Build and deployment → Source**, select **GitHub Actions**. Leave **Custom domain** blank to use the default GitHub URL.
3. Under [Settings → Actions → General](https://github.com/julianbolts/nyc-transit-map/settings/actions), ensure GitHub Actions is enabled and the `actions/*` actions used by the workflows are allowed. The workflows declare their required token permissions; no personal access token or additional secret is needed.
4. If branch rules protect `main`, ensure the existing schedule refresh workflow can push its validated template commits, or adapt that workflow to your branch policy. If the `github-pages` environment has deployment branch restrictions, allow `main`; required reviewers will pause each deployment for approval.
5. Merge or push these files to `main`. In **Actions → Deploy demo to GitHub Pages**, wait for the run to finish. If setup was completed after the first run failed, select **Run workflow → main → Run workflow**. The successful deployment links to the demo URL above. For an immediate schedule update, manually run **Refresh schedule snapshots** on `main`; a successful run then deploys the demo automatically.

GitHub documents [custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [why pushes made with `GITHUB_TOKEN` do not trigger another push workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow). The deployment uses `workflow_run` to follow the refresh without needing another token.

## Monthly refresh

`.github/workflows/refresh-schedules.yml` downloads official feeds on the **first of each month at 06:15 UTC** (01:15 EST / 02:15 EDT). Manual dispatch remains available. Its existing Actions name, **Refresh schedule snapshots**, is retained so the Pages deployment integration continues to work.

The Python importer builds reusable weekday variants, preserves compatible seasonal periods, and validates stops, times, and canonical geometry. Unverified future geometry is reported and the last usable week continues. If a mode's current candidate fails, its prior recurring schedule is retained while the healthy mode can update. If neither candidate passes, all published files remain unchanged. Diagnostics and retained import dates appear in the Actions summary. Feed downloads have three bounded attempts within the run.

```sh
npm run refresh:schedules
# Reproduce an import from subway.zip and ferry.zip:
python3 scripts/refresh-schedules.py --feed-dir /tmp --date 2026-10-27
```

The importer stages the direct schedule files, route metadata, and coherent `transit-bundle.json`. CI validates and builds before committing; successful refreshes on `main` automatically deploy the static GitHub Pages demo. The repository must allow Actions to write contents and push to its default branch. Committing data does not update installed package versions: distribute refreshed assets through your own release/CDN pipeline.

Geometry remains a separate authoring task. The checked-in source fingerprint registry was bootstrapped against existing canonical IDs; monthly runs never reseed it or change the verified network. After reviewing source geometry against the canonical network, `--seed-geometry --feed-dir ...` can record the initial bindings. Do not use this flag as a way to approve unreviewed path changes. For new paths, add the verified canonical geometry and reviewed fingerprint bindings together. `scripts/validate-water.mjs` is an authoring/clipping utility that requires downloaded z12 water tiles under `/tmp/water-tiles`; it is not an automated approval gate. The current unverified South Brooklyn Governors Island landing uses the prior verified weekly service until its geometry is authored.

See [the investigation and migration record](docs/MONTHLY-SCHEDULE-PLAN.md) for the original outage and design.
