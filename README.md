# City in Motion

A quiet full-screen NYC subway and ferry map. Pan and zoom are locked by default. Gear settings enable navigation and independent live feeds. Selecting a vehicle opens its journey timeline.

## Data and animation

- `scripts/prepare-transit.py` imports official MTA regular subway GTFS and NYC Ferry GTFS downloaded into `/tmp/subway.zip` and `/tmp/ferry.zip`. Calendars and holiday exceptions are respected; trips after midnight retain their service date.
- `data/transit.json` stores timetables using shared timing patterns. Current data was imported September 24, 2026. This is a bundled schedule snapshot, not an automatic feed-refresh job. Refresh and redeploy before the feed calendars expire. Regular MTA schedules omit some temporary service changes.
- `public/data/network.json` stores canonical station-pair geometry and signed edge references. Negative references read the same coordinate list in reverse. Different geometry is retained as a variant. Express trains can pass intermediate graph stations without stopping.
- `lib/transit-geometry.ts` exports `getSegment(shapeId, path, from, to, minimumDistance)` and caches by geometry revision, directed shape, station pair, and loop occurrence. Trip dates and predictions never invalidate geometry. Animation follows cumulative route distance, including corrections between feed refreshes.
- Ferry shore-side approaches are clipped using OpenStreetMap water polygons; the displayed routes and animated positions use the same adjusted shapes.
- `/api/transit` fetches and decodes public GTFS-RT on the server. Subway trip IDs are normalized against static trips. Fresh matching arrivals update timings; ferry GPS is matched to route geometry. Unavailable or stale feeds explicitly fall back to schedules. Extra real-time trips without a matching static trip are not rendered.
- MTA feeds represent station/arrival predictions, not precise underground GPS. This is a visualization, not a navigation app.

## Validation

`node --experimental-strip-types scripts/check-geometry.mjs` checks cache reuse, segment ordering and valid positions against all imported route/timing patterns.

`node --experimental-strip-types scripts/validate-water.mjs` validates and clips ferry geometry against z12 CARTO/OpenStreetMap water tiles in `/tmp/water-tiles`. Tiles use filenames `X-Y.mvt` (gzip). Download tiles covering the map region before rerunning this check. It is an authoring-time check, not a runtime network dependency.

MapLibre draws the main map; a Canvas/Leaflet renderer uses the same vector tiles on browsers without WebGL2. Data attribution remains visible. Icons are Lucide TrainFront, Ship and Settings.

## Loading and cache policy (September 24 fix)

The production blank map was caused by a missing MapLibre ESM worker asset (404), not an observed agency rate limit. Worker and shared-module assets are explicitly shipped under the versioned `/vendor/maplibre-6.10.0/` directory. Lightweight same-origin map backdrops render before JavaScript or transit data. Map, geometry and schedule requests run independently, with an 8-second map fallback and 12-second data request timeout.

The default mode fetches `/api/schedule` once for the current New York day, persists the result in the browser Cache API and selects/animates trips locally. Concurrent requests share a promise. The server also caches each day's compact response in memory and the Cloudflare edge cache. The cache expires at local midnight (at most 24 hours); it is distinct from the publication date of the bundled agency timetable. It does not automatically reimport newer upstream schedule files.

Live feeds are fetched server-side only when enabled, cached by source URL across visitors at each Cloudflare edge location, and deduplicated within each worker isolate. Cache TTLs are 30 seconds for MTA and 60 seconds for NYC Ferry. Failed requests back off for 60 seconds; HTTP Retry-After is respected (30 seconds–1 hour). Stale live timestamps still trigger the labeled schedule fallback.

Suggested upstream schedule revalidation: daily for regular MTA GTFS (officially updated a few times per year), hourly if adopting MTA supplemented GTFS (officially updated hourly), daily for NYC Ferry GTFS (no published cadence found). Use Last-Modified/ETag during an import refresh. Geometry and style cache for 30 days; versioned worker assets cache for one year.

Sources: https://www.mta.info/developers ; https://www.mta.info/document/134521 (feed generated every 30 seconds); https://www.ferry.nyc/developer-tools/ (publishes endpoints, no update frequency).

`node scripts/check-loading-cache.mjs` verifies request coalescing, cache hits, expiration and presence of the packaged worker/backdrop assets.
