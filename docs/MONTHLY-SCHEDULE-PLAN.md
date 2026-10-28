# Monthly schedule templates: investigation and implementation plan

Investigated October 27, 2026. Implementation followed user approval: recurring evaluation, independent import fallback, monthly cron, source fingerprint bindings, and seeded assets are now in the working tree. Deployment is still required. The design below records the original plan.

Implementation detail: a single self-contained `transit-bundle.json` supplies schedules, geometry, and metadata atomically, instead of a manifest with separate revisioned files. Governors Island service retains the prior verified template; new landing geometry has not been approved. The existing water-clipping utility remains an authoring tool and is not used as a validation gate.

## Confirmed cause of the outage

The public refresh runs succeeded on October 23 and failed October 24–27. The published subway and ferry JSON both have `date: 2026-10-23` and `validUntil` corresponding to **October 25 at 00:00 America/New_York**. Running the current reconciliation code against those downloaded files on October 27 returns zero vehicles and the expired-snapshot notice.

The public main-branch importer, schedule evaluator, refresh workflow, and hosted network are identical to this checkout's versions, although the checkout's schedule JSON is older than production.

The current official feeds reproduce the supplied error exactly: subway generates 17,261 trip instances, then ferry rejects `ferry:154` and `ferry:155`. The ferry feed is version `20261025`. Both shapes are used by South Brooklyn service IDs `3` and `7`, whose calendars start **November 2**. Neither shape is referenced by the October 27 output if generation is allowed to proceed; there are 508 ferry trip instances for that snapshot.

There are three interacting problems:

1. In `scripts/refresh-schedules.py`, unknown shapes are collected before checking service activity. Even unused future or expired trips can reject the import. Route metadata is also built from every trip rather than the selected output.
2. Both modes must generate successfully before either file is written. A ferry failure prevents a healthy subway update. The refresh workflow then skips validation and commit, and the Pages workflow only follows successful refresh runs.
3. The browser rejects schedules at their two-day expiry. Trips also contain absolute service-date epochs: removing expiry or increasing it to a month still produces zero vehicles after those trip dates pass. This was reproduced independently against the hosted files.

The shape changes need actual geometry work. Existing South Brooklyn shapes `137`/`136` serve stop `111`, Gov. Island/Yankee Pier. New shapes `154`/`155` serve stop `65`, Governors Island, at different coordinates. The verified network has no Red Hook–stop 65 edge. These are not simple ID renames.

Evidence: [October 23 successful run](https://github.com/julianbolts/nyc-transit-map/actions/runs/39947636938), [October 27 failed run](https://github.com/julianbolts/nyc-transit-map/actions/runs/40501955607), [published subway JSON](https://julianbolts.github.io/nyc-transit-map/data/subway-schedule.json), [published ferry JSON](https://julianbolts.github.io/nyc-transit-map/data/ferry-schedule.json).

## Recommended behavior

Treat the Pages animation as a recurring, representative timetable. Refresh its source data once per month. Holidays follow their ordinary weekday; no holiday detection is required. Show “Typical schedule · estimated positions” and the original import date, rather than implying that replayed templates are today's official service.

Keep seven weekday selectors internally, deduplicated into shared variants. Monday–Friday can share one variant when their actual trips agree; Saturday and Sunday remain separate when necessary. Friday-only and Sunday-only trips therefore work without special cases or a fixed assumption about the number of variants.

Retain known effective-date changes from each downloaded feed. The current ferry feed already distinguishes service before and after November 2 and introduces another weekend service on November 7. Conversely, the downloaded subway feed ends October 31. A monthly importer must handle both future changes and feeds that do not cover the coming month. Source coverage is provenance, not a reason to erase a decorative animation.

## Data contract

Introduce a versioned recurring schedule format, while continuing to accept existing dated `ScheduleData` from embedding hosts. Use a discriminated union so dated snapshots retain their existing expiry semantics.

Recurring data should contain:

| Field | Purpose |
| --- | --- |
| `schemaVersion`, `kind: "weekly-template"`, `version` | Explicit interpretation and cache revision |
| `timezone: "America/New_York"` | Service-day calculation independent of viewer location |
| `generatedAt`, `refreshAfter`, `sources` | Import time, expected next refresh, source URLs, feed versions and coverage |
| `stops`, `routes`, `patterns` | Existing shared dictionaries and relative timing patterns |
| `trips` | Trip ID, route, headsign, canonical shape, pattern index, start seconds; **no absolute service epoch** |
| `variants` | Named lists of trip indices, deduplicated by timetable content |
| `periods` | Nonoverlapping effective-date ranges, each mapping Monday–Sunday to variants |
| `fallbackWeek` | Complete weekday mapping to the last usable representative variants outside covered dates |
| `quality` | Retained older mode, unresolved geometry, missing coverage, and related import diagnostics |

A legitimate empty variant means no service; distinguish it from a missing or rejected variant. Do not replace real non-operating days with invented service. New geometry must resolve to canonical verified shape IDs, not just upstream IDs.

## Import and geometry changes

1. Separate GTFS parsing, recurring service selection, geometry resolution, validation, and publication. Keep `--feed-dir` for repeatable imports. Do not change the cadence until recurring assets and runtime support are ready.
2. Build effective periods from regular calendar start/end boundaries. For each weekday in each period, combine only services active together; deduplicate resulting trip sets. Do not union mutually exclusive summer/winter or old/new schedules. Ignore calendar exceptions for ordinary recurring templates. If a feed supplies service solely through `calendar_dates.txt`, derive representative weekday trip sets from repeated dated service and record the selected source dates; do not discard that feed as empty.
3. Validate geometry only for selected template trips. Report other upstream shapes separately so inactive future data cannot block an unrelated period. Unsupported future periods fall back to the prior usable weekly templates until their geometry is approved.
4. Decouple agency shape identity from the verified network. Record source geometry fingerprints and reviewed mappings to canonical paths. Reuse a path automatically only when its source fingerprint and ordered stops/direction establish equivalence; validate changed geometry even if its upstream ID stays the same. New IDs alone are neither proof of change nor proof of equivalence. For this incident, explicitly author/review the changed Governors Island leg before using it.
5. On a rejected mode candidate, retain that mode's last usable **recurring** bundle and publish the healthy mode. Start with mode-level fallback to keep selection and metadata consistent; route-level recovery can be added later if needed. Always emit a workflow summary with unresolved shapes, affected routes, retained source dates, counts, and missing coverage. Preserve the whole published bundle if no candidate is usable.
6. Derive route metadata from the union of the templates actually published, including retained fallback templates. Stage and validate all files before the Git commit; GitHub Pages deploys the coherent result. First-time migration needs explicitly seeded usable recurring data for both modes—retaining an expired dated snapshot does not solve the problem.

Keep geometry approval separate from ordinary monthly downloads. The existing `validate-water.mjs` mutates geometry, skips missing tiles, and only logs off-water failures. Before using it as an approval gate, split clipping from validation and make missing required tiles, invalid connectivity/stop ordering, and off-water paths fail the geometry check. Timetable-only refreshes can reuse already verified geometry without downloading water tiles.

## Browser and Pages changes

In `src/schedule.ts`, materialize recurring trips onto the current New York service date, using the appropriate period or fallback weekday variant. Include prior service dates whose trips still overlap now; derive the necessary lookback from maximum trip end seconds rather than assuming trips never exceed 48 hours. Preserve GTFS times beyond 24:00. Select the prior day's own variant for overnight carryover, including Friday–Saturday and Sunday–Monday transitions.

Calculate each service base from **New York local noon minus twelve elapsed hours**. Do not shift a saved epoch by a multiple of 86,400 seconds or use the browser's local timezone. Include the materialized service date in vehicle IDs. Cache daily materialization by schedule revision and New York date; let the existing 30-second reconciliation and animation continue. Recompute on date changes and after a sleeping tab resumes, without requiring a download.

Recurring templates do not hard-expire. Continue using the last usable week after `refreshAfter`; show an unobtrusive stale-template indication after a seven-day grace period. Preserve original provenance. Live-mode precedence, omitted-mode fallback, and explicit empty live arrays retain their current behavior.

Update `src/data.ts`, `src/types.ts`, package exports, `src/TransitMap.tsx`, and demo copy for the new format. Use a shared bundle revision for schedule, metadata, and geometry requests; the current 30-day geometry/metadata browser cache can otherwise combine newly deployed schedules with old paths. A small short-lived manifest pointing at revisioned asset directories is one suitable implementation. Keep the existing Pages base-path handling and make ordinary reloads discover the current manifest.

Change `.github/workflows/refresh-schedules.yml` to `15 6 1 * *` (first of each month, 06:15 UTC; 01:15 EST / 02:15 EDT). Keep manual dispatch. Add bounded retries for transient feed download failures within that run, with staging so failed downloads preserve published templates. Keep the existing workflow name and successful `workflow_run` deployment integration. Update commit messages and documentation from snapshots/nightly to templates/monthly. Do not add another scheduled refresh or a runtime agency request.

GitHub can delay or drop scheduled runs, so rendering must not depend on the next job finishing on time. See [GitHub's schedule event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). GTFS calendar, overnight-time, and service-base behavior is defined in the [GTFS schedule reference](https://gtfs.org/documentation/schedule/reference/).

## Implementation order and acceptance checks

1. Add the recurring schema and evaluator with backward-compatible dated schedules. Test arbitrary future dates with unchanged template files; New York weekday selection under another viewer timezone; overnight/weekend/month/year transitions; both DST changes; stable vehicle IDs; legitimate no-service variants; and existing live fallback behavior.
2. Refactor the importer and build recurring fixtures for both modes. Test inactive unknown shapes, renamed equivalent shapes, changed geometry under a reused ID, genuinely new terminal geometry, overlapping/exclusive calendars, different Saturdays/Sundays, exception-only calendars, feed coverage ending early, and failure preserving the previous recurring mode. Check that every published trip references valid stops, timing patterns, routes, and verified geometry.
3. Resolve/review the Governors Island geometry or retain a clearly labeled prior verified South Brooklyn template for bootstrap. Generate and validate both recurring bundles, metadata, provenance, and fallback weeks before changing the workflow cadence.
4. Update loader/cache revision handling, UI labels, README, and architecture documentation. Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run build:demo -- --base=/nyc-transit-map/`. Inspect the built static demo at weekday, Saturday, Sunday, overnight, and post-refresh-deadline clocks. Verify that a new bundle bypasses previously cached geometry/metadata.
5. Deploy the compatible code and seeded templates together, then enable monthly cron. Manually exercise one refresh and its follow-on Pages deployment. Confirm that a simulated failed feed/geometry refresh leaves both modes animated from usable templates and surfaces the diagnostic. No backend is needed.

Investigation validation: the existing three Python importer tests and six TypeScript schedule tests pass. Additional read-only probes reproduced the production exception, inactive-service rejection, hosted expiry, and zero vehicles even with expiry bypassed. Implementation tests and build verification are described in the task result; the published site has not yet changed.
