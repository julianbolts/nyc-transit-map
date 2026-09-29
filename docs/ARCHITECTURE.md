# Architecture and migration

The starting repository was a Sites/Vinext/Next application with Cloudflare bindings, database examples, dozens of unused UI components, framework-specific installers and server routes for schedule selection and GTFS realtime decoding. `app/transit-map.tsx` was already client-rendered but owned data fetching, root-relative asset paths and fixed-position controls. Its icon markup used `react-dom/server`, and copied MapLibre workers tied it to a particular deployment/version.

The new repository has three boundaries:

| Boundary | Files | Responsibility |
| --- | --- | --- |
| Reusable presentation | `src/TransitMap.tsx`, `src/settings-panel.tsx`, `src/icons.tsx`, `src/styles.css` | Map lifecycle, local animation, popups, controls; accepts schedule/live/settings props |
| Transit logic and assets | `src/schedule.ts`, `src/transit-geometry.ts`, `public/data/`, `public/map/` | Timetable reconciliation, immutable geometry reuse, CI-generated JSON and verified basemap assets |
| Host integration | `src/data.ts`, `demo/main.tsx`, `scripts/refresh-schedules.py`, `.github/workflows/refresh-schedules.yml` | Mock JSON loading, container example and upstream import outside runtime |

The library reads static map geometry/style through an explicit configurable asset base. It never fetches timetable data or live APIs. The host passes separate subway/ferry schedules and normalized optional live vehicle arrays. Mode settings select timetable versus supplied live data. Missing live data falls back per mode; empty live arrays mean no vehicles. The host owns live-feed credentials, freshness and normalization.

MapLibre and React are external peers. The host supplies a bundled MapLibre module worker URL, so the library does not copy workers or engine code. The optional `nyc-transit-map/leaflet` export loads the Canvas/Leaflet adapter separately and requires its own peers. CSS is scoped to `.nyc-transit-map`; controls are positioned inside the component; a ResizeObserver follows the host container's dimensions. IDs are unique across instances.

The package build emits native ESM with type declarations, a CSS export and separate JSON/image assets. The root entry preserves its `use client` directive for React Server Components hosts, while data utilities remain a separate entry. JSON is not embedded into JavaScript. The production demo is a separate static build, and its renderer/framework dependencies are bundled for that standalone app only.

The nightly Python importer downloads regular MTA subway GTFS and NYC Ferry GTFS, checks calendar exceptions and stop/shape references, shares timing patterns, retains overnight trips and includes the following day to bridge midnight before CI runs. GTFS clocks use New York local noon minus twelve elapsed hours on DST transition dates. Snapshot expiry uses actual New York midnight. New shape IDs fail the import rather than replacing the previously water-clipped network with unchecked geometry.

The workflow refreshes snapshots in Git. Existing package installations need a release or updated asset deployment to receive newer data. Branch-protected repositories may need to adapt its final push step. Runtime applications have no CI, agency, database or server dependency.

Run `npm run dev` for the container demo. `/embed-test.html` is a development fixture that verifies two simultaneous instances, a hidden gear, controlled settings, live ferry clearing and CSS isolation. `npm run build:demo` only publishes the main demo entry.
