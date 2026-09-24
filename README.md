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
