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

The monthly Python importer builds recurring weekday templates from official MTA subway GTFS and NYC Ferry GTFS. It combines services only within their effective calendar periods and preserves separate Saturdays/Sundays or other weekday differences. Holidays use their ordinary weekday. Dated-only feeds can infer representative weekday patterns. Source coverage, feed versions, import times, and unsupported periods remain visible in provenance and the Actions summary.

`src/schedule.ts` materializes templates onto the current New York service dates and includes prior service days with overnight trips. Service bases use local noon minus twelve elapsed hours on DST transition dates. Daily materialization is cached, recomputed across midnight, and reconciled after the tab resumes. Recurring templates never expire; stale templates continue animating with an unobtrusive status. Original host-supplied dated snapshots retain their expiry semantics.

The source geometry registry fingerprints agency paths and ordered stop locations independently of agency shape IDs. A changed path under an existing ID is rejected, while a renamed equivalent shape can reuse its verified canonical path. Unsupported future periods use the last usable week. A failed current mode import retains that mode's existing recurring timetable, while the other mode can update. Geometry approval remains separate from monthly imports; unverified ferry paths never overwrite water-clipped geometry.

The mock loader fetches one self-contained static `transit-bundle.json` containing both schedules, network, and metadata. This prevents newly deployed timetables from mixing with a 30-day geometry cache. It caches requests for a minute, reuses object references for an unchanged bundle revision, and falls back to the last persisted bundle if revalidation fails. `TransitMap` uses the supplied bundle assets; embedding hosts can still omit them and serve geometry through `assetBaseUrl`.

The refresh workflow runs on the first of each month at 06:15 UTC and supports manual dispatch. It stages all outputs, validates/builds, commits usable templates in Git, and triggers the existing Pages deployment. If neither mode updates, published files remain unchanged. Installed packages still need a release or asset deployment to receive newer data. Runtime applications need no agency requests, server, or database.

Run `npm run dev` for the container demo. `/embed-test.html` is a development fixture that verifies two simultaneous instances, a hidden gear, controlled settings, live ferry clearing and CSS isolation. `npm run build:demo` only publishes the main demo entry.
