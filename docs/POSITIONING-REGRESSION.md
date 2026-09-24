# Transit positioning regression — 2026-09-24

Status: fixed and verified; publishing through Sites workflow. Replaces completed ICON-UPDATE-HANDOFF.md.
Site: appgprj_6ab58748229c8191a1875b464abf7e1e
URL: https://city-in-motion.juliansoro-dev.chatgpt.site
Checkout: /workspace/sites/city-in-motion
Starting commit: b73c4d3205cfd41f9906b21efff101d7e1802ea5

## Tasks
- [x] Record report: displaced subway badges, red trains scattered, other lines apparently absent.
- [x] Verify route assignments and cached edge/segment positions across subway lines.
- [x] Diagnose primary MapLibre rendering separately from Leaflet fallback.
- [x] Repair positioning while preserving canonical bidirectional edge geometry.
- [x] Add targeted regression coverage and verify route colors/visibility.
- [x] Build and publish; record results and remaining limitations here.

## Findings so far
Existing geometry checks pass all 4,538 shape/timing patterns. Icon-update CSS sets `.vehicle,.vehicle.ferry { position:relative }`, which overrides MapLibre's absolute-positioned marker root. Leaflet wraps the badge in its own positioned element, so its preview can look correct despite a primary-renderer regression. Investigate this CSS conflict first; do not regenerate geometry to compensate for screen placement errors.

## Preserve
- public/data/network.json: canonical edges, signed reverse refs, shore-safe ferry geometry.
- lib/transit-geometry.ts: segment and journey memoization, cumulative-distance animation.
- lib/transit-style.ts: route palettes, diamonds only 6X/7X/FX, heading arrows.
- White subway dots, blue ferry anchors, name-only station popups and vehicle schedules.
- Independent first-paint map, schedule caching, default locked interactions.
- MapLibre worker and shared module in public/vendor/maplibre-6.10.0.
- Ferry route IDs RES/RWS are connecting buses; RS is Rockaway–Soundview ferry.
- Timetable auto-reimport remains unimplemented; metadata must be regenerated after imports.

## Confirmed cause and fix
The primary marker root had `position:relative`, adding 30 pixels of normal document-flow displacement per preceding visible badge. Early red trains appeared scattered; later route badges were pushed off-screen. Route data was not missing. The shared badge rule no longer specifies positioning; relative positioning is scoped to `.vehicle-holder>.vehicle` for Leaflet only. MapLibre retains its own `position:absolute;top:0;left:0` and geographic transform. No route coordinates or segment keys were changed.

## Verification
- Browser fixture with production CSS and MapLibre marker DOM: before fix, 16 markers displaced by 0–450px; after fix, all absolute-positioned with exactly zero error.
- `node scripts/check-geometry.mjs`: all 4,538 shape/timing patterns pass; 13,614 animated positions lie on their original decoded cached paths; all 29 subway line assignments match metadata.
- `node scripts/check-transit-style.mjs`: palettes, express designations, headings and station metadata pass.
- Browser environment lacks WebGL2. Primary marker layout was verified independently of WebGL via the actual marker CSS and DOM contract; the full map preview uses Leaflet fallback.
- Reproduce layout check: `node scripts/check-marker-layout.mjs`; open `/__marker-layout.html` in the managed preview. The visible JSON must report pass=true and all position errors=0. Remove generated public/__marker-layout.html before packaging. Fixture generator remains in source for future regression checks.
- Build and deployment identifiers: see git HEAD and Sites version history. Publish must succeed before reporting complete.

## Remaining work
None for this regression. Existing limitation: official timetable auto-reimport is not yet implemented. Preserve this document for future map layout changes.
