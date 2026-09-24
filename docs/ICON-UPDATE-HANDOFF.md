# City in Motion — icon update handoff

Status: IMPLEMENTED AND PREVIEW-VERIFIED (2026-09-24). Read this file first after a context reset.

## Site and source
- Checkout: `/workspace/sites/city-in-motion`
- Project: `appgprj_6ab58748229c8191a1875b464abf7e1e`
- URL: https://city-in-motion.juliansoro-dev.chatgpt.site
- Starting deployed commit: `42b7bb466765b4d11faf956cace999b9c1107aeb` (version 2).
- Follow Sites opening/publishing workflow; preserve private audience. Do not create another Site.

## Requested result
1. Subway markers: route-colored circular CSS badges, bold upright sans-serif route letters/numbers. Use consistent character widths. Express variants (6X, 7X, FX) display 6, 7, F in diamonds; ordinary express lines such as A/D remain circles, matching the supplied legend.
2. Broad directional arrow attached to each moving badge. Rotate the arrow with the route tangent, keeping route labels/boat glyphs upright. Reverse trips should naturally point the opposite way. Remain stable while dwelling and handle the 359°/0° transition.
3. Subway paths: muted dark versions of the route colors. Overlap is explicitly allowed; do not invent lane offsets. Same behavior in MapLibre and Canvas/Leaflet fallback.
4. Ferry vehicles: white boat glyph on a colored circle. Reference palette: East River teal; South Brooklyn gold; Astoria orange; Rockaway–Soundview purple; St. George magenta; Governors Island gray. GTFS IDs differ from display codes: ER, SB→SBK, AS→AST, RS→RWS, SG→STG, GI→GOV. Preserve legacy RWS/RES aliases distinctly if present in data.
5. Ferry stops: smaller circular anchor markers below vehicles. All ferry landings use BLUE circles with WHITE anchors, per latest user clarification; do not use route-colored rings or duplicate a marker per calling route. Accessible terminal name/route label.
6. Subway stations: WHITE dots with BLACK outline, rendered below moving badges in both map engines.
7. Keep existing dark map, loading fix, caches, schedule tooltip, locked default view and settings behavior. No new page chrome.

## Implementation plan
- [x] Save this plan before implementation.
- [x] Add shared route palettes/aliases and CSS badge construction.
- [x] Add memoized route metadata linking each shape to its subway/ferry line; publish a small metadata asset without reimporting schedules.
- [x] Compute heading from points just before/after the current interpolated route distance; rotate only arrow wrapper.
- [x] Color path layers in both renderers from feature properties.
- [x] Build deduplicated ferry terminal anchor markers and clean them up on renderer swaps/unmount.
- [x] Validate badge labels, express diamonds, route aliases, arrows in opposite directions, station deduplication and schedule taps.
- [x] Type-check and verify production worker assets; build and publication run through Sites workflow. See Sites version history for the terminal deployment outcome.
- [x] Record validation and remaining limitations; final commit/deployment identifiers live in git and Sites version history.

## Important files and constraints
- `app/transit-map.tsx`: lifecycle, marker creation/update, route layers, tooltips/settings.
- `app/globals.css`: visual styling. Replace old vehicle rules as a group to avoid conflicting overrides.
- `lib/transit-geometry.ts`: immutable bidirectional network, cached segments, cumulative distance animation. Do not regress shore-safe paths or add straight-line movement.
- `lib/map-fallback.ts`: Canvas vector map + Leaflet compatibility wrappers; route styling must match primary renderer.
- `data/transit.json`: bundled official schedules, shared timing patterns.
- `public/data/network.json`: canonical geometry edges plus signed direction references. Do not rerun importer casually: ferry shore clipping is applied after import.
- `lib/schedule.ts`, `lib/client-cache.ts`, `lib/feed-cache.ts`: previous caching fix. Default is one schedule fetch/day, live feeds cached 30s subway / 60s ferry, per edge location; requests coalesced per isolate. Automatic upstream reimport remains unimplemented.
- `/public/vendor/maplibre-6.10.0/`: worker AND shared ESM dependency must ship. Prior production blank map was a missing worker 404.
- `/public/map/backdrop-*.webp`: real geographic first paint while data arrives.

## Reference images
Visible user-supplied screenshots in the conversation are authoritative for styling. Local attachment paths were reported missing; do not claim pixel-exact sampled colors. No need to reproduce screenshots or use ImageGen for functional icons.

Feed detail discovered during implementation: ferry GTFS routes RES/RWS are route_type=3 (bus connectors). Exclude their paths, vehicles and land stops from the boat view. Route RS is the requested Rockaway–Soundview ferry (display RWS).

## Validation and continuation
TypeScript passes. `node scripts/check-transit-style.mjs` passes palette, express designation, directional bearing and wrap checks; metadata contains 496 subway station nodes and 25 deduplicated ferry landings. `node scripts/check-loading-cache.mjs` passes request coalescing, cache reuse/expiry and worker/backdrop presence. Browser screenshot verified Canvas fallback badges, blue anchors, white station dots, muted paths, and map visible before schedules. Browser lacks WebGL2, so primary renderer is type-checked but not visually exercised here. Re-run `python scripts/prepare-route-meta.py` after future timetable imports; preserve geometry network. The final source commit and deployment version are available from git and Sites version history.

Schedule popup verified by opening a ferry marker: journey times, passed stops and Approaching label are present.

Station tooltip update: clicking a subway dot (12px hit radius, nearest station) or ferry anchor opens a name-only light popup. Shared popup selection prevents vehicle animation from moving station tooltips. Both renderers project station coordinates for hit detection; blank-map clicks dismiss. Ferry anchors are keyboard-operable buttons.
