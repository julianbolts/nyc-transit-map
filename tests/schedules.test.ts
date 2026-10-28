import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveVehicles,
  scheduledVehicles,
  newYorkDate,
  newYorkServiceBase,
  materializeTrips,
} from "../src/schedule.ts";
import type { WeeklyScheduleData, DatedScheduleData } from "../src/schedule.ts";
import type { TransitSchedules } from "../src/types.ts";
import type { Vehicle } from "../src/transit-geometry.ts";

const schedules: TransitSchedules = {
  subway: JSON.parse(readFileSync("public/data/subway-schedule.json", "utf8")),
  ferry: JSON.parse(readFileSync("public/data/ferry-schedule.json", "utf8")),
};
const noon = Date.parse("2026-10-27T16:00:00Z") / 1000;

function weekly(): WeeklyScheduleData {
  return {
    schemaVersion: 2,
    kind: "weekly-template",
    timezone: "America/New_York",
    version: "fixture",
    generatedAt: "2026-10-01T00:00:00Z",
    refreshAfter: Date.parse("2026-11-01T06:15:00Z") / 1000,
    sources: { subway: { downloaded: "2026-10-01T00:00:00Z" } },
    stops: { a: ["A", -74, 40.7], b: ["B", -73.99, 40.71] },
    routes: { r: ["1", "One", "subway"] },
    patterns: [
      [
        ["a", 0, 0, 1],
        ["b", 3600, 3600, 2],
      ],
    ],
    trips: [
      ["weekday", "r", "B", "s", 0, 12 * 3600],
      ["saturday", "r", "B", "s", 0, 12 * 3600],
      ["sunday", "r", "B", "s", 0, 12 * 3600],
      ["friday-night", "r", "B", "s", 0, 23.5 * 3600],
      ["sunday-night", "r", "B", "s", 0, 23.5 * 3600],
    ],
    variants: { wd: [0], fri: [0, 3], sat: [1], sun: [2, 4] },
    periods: [],
    fallbackWeek: ["wd", "wd", "wd", "wd", "fri", "sat", "sun"],
    quality: { notes: [] },
  };
}
function at(data: WeeklyScheduleData, time: string) {
  return scheduledVehicles(data, Date.parse(time) / 1000);
}

test("published templates have complete weekday selectors and verified references", () => {
  const network = JSON.parse(readFileSync("public/data/network.json", "utf8"));
  for (const mode of ["subway", "ferry"] as const) {
    const data = schedules[mode];
    assert.equal(data.kind, "weekly-template");
    if (data.kind !== "weekly-template") throw Error("Expected templates");
    assert.equal(data.fallbackWeek.length, 7);
    assert.ok(data.trips.length > 0);
    for (const [, route, , shape, pattern] of data.trips) {
      assert.equal(data.routes[route][2], mode);
      assert.ok(network.shapes[shape]);
      assert.ok(data.patterns[pattern].length >= 2);
      for (const [stop] of data.patterns[pattern]) assert.ok(data.stops[stop]);
    }
    for (const name of data.fallbackWeek) assert.ok(data.variants[name]);
    assert.ok(scheduledVehicles(data, noon).length > 0);
  }
});

test("unavailable live modes fall back independently; [] explicitly clears a mode", () => {
  const ferry = scheduledVehicles(schedules.ferry, noon)[0];
  const result = resolveVehicles(
    schedules,
    { ferry: [{ ...ferry, live: true }] },
    { subway: true, ferry: true },
    noon,
  );
  assert.ok(result.vehicles.some((v) => v.mode === "subway" && !v.live));
  assert.deepEqual(
    result.vehicles.filter((v) => v.mode === "ferry"),
    [{ ...ferry, live: true }],
  );
  assert.match(result.status.subway, /Live unavailable.*typical schedule/);
  const cleared = resolveVehicles(
    schedules,
    { ferry: [] },
    { subway: false, ferry: true },
    noon,
  );
  assert.ok(cleared.vehicles.length > 0);
  assert.ok(cleared.vehicles.every((v) => v.mode === "subway"));
});

test("disabled live settings use templates even with host-provided vehicles", () => {
  const live = { id: "live", mode: "subway" } as Vehicle;
  const result = resolveVehicles(
    schedules,
    { subway: [live] },
    { subway: false, ferry: false },
    noon,
  );
  assert.ok(result.vehicles.length > 0);
  assert.ok(result.vehicles.every((v) => v.id !== "live"));
});

test("a missed monthly refresh never expires templates or asks to refresh the map", () => {
  const result = resolveVehicles(
    schedules,
    undefined,
    { subway: false, ferry: false },
    Date.parse("2030-08-20T16:00:00Z") / 1000,
  );
  assert.equal(result.notice, undefined);
  for (const mode of ["subway", "ferry"] as const) {
    assert.ok(result.vehicles.some((v) => v.mode === mode));
    assert.equal(result.status[mode], "Typical schedule · older template");
  }
});

test("legacy host-supplied dated snapshots still respect their own expiry", () => {
  const data = weekly();
  const dated: DatedScheduleData = {
    ...data,
    kind: "snapshot",
    date: "2026-10-27",
    validUntil: noon + 100,
    trips: [
      ["dated", "r", "B", "s", 0, 43200, newYorkServiceBase("2026-10-27")],
    ],
  };
  assert.equal(scheduledVehicles(dated, noon).length, 1);
  const result = resolveVehicles(
    { subway: dated, ferry: dated },
    undefined,
    { subway: false, ferry: false },
    noon + 101,
  );
  assert.equal(result.vehicles.length, 0);
  assert.match(result.notice!, /expired/);
});

test("New York service date differs from UTC and the viewer's timezone", () => {
  assert.equal(newYorkDate(new Date("2026-09-30T02:00:00Z")), "2026-09-29");
  assert.equal(
    at(weekly(), "2026-10-31T16:30:00Z")[0].id,
    "saturday:2026-10-31",
  );
  assert.equal(at(weekly(), "2026-11-01T17:30:00Z")[0].id, "sunday:2026-11-01");
});

test("overnight service keeps Friday's and Sunday's own variants after midnight", () => {
  const data = weekly();
  assert.deepEqual(
    at(data, "2026-10-31T04:15:00Z").map((v) => v.id),
    ["friday-night:2026-10-30"],
  );
  assert.deepEqual(
    at(data, "2026-10-26T04:15:00Z").map((v) => v.id),
    ["sunday-night:2026-10-25"],
  );
});

test("effective periods override a typical week without merging seasonal schedules", () => {
  const data = weekly();
  data.periods = [
    {
      from: "2026-11-02",
      through: "2026-11-30",
      week: Array(7).fill("sat") as WeeklyScheduleData["fallbackWeek"],
    },
  ];
  assert.equal(at(data, "2026-10-27T16:30:00Z")[0].id, "weekday:2026-10-27");
  assert.equal(at(data, "2026-11-02T17:30:00Z")[0].id, "saturday:2026-11-02");
  assert.equal(at(data, "2026-12-01T17:30:00Z")[0].id, "saturday:2026-12-01");
});

test("an unsupported gap keeps the previous season until the next verified period starts", () => {
  const data = weekly();
  data.periods = [
    { from: "2026-10-01", through: "2026-11-01", week: data.fallbackWeek },
    {
      from: "2026-11-07",
      through: "2026-11-30",
      week: Array(7).fill("sat") as WeeklyScheduleData["fallbackWeek"],
    },
  ];
  assert.equal(at(data, "2026-11-03T17:30:00Z")[0].id, "weekday:2026-11-03");
  assert.equal(at(data, "2026-11-07T17:30:00Z")[0].id, "saturday:2026-11-07");
});

test("empty weekend variants mean genuinely no scheduled service", () => {
  const data = weekly();
  data.variants.sun = [];
  assert.deepEqual(at(data, "2026-10-25T16:30:00Z"), []);
});

test("GTFS noon stays at local noon during both DST changes", () => {
  assert.equal(
    new Date((newYorkServiceBase("2026-03-08") + 43200) * 1000).toISOString(),
    "2026-03-08T16:00:00.000Z",
  );
  assert.equal(
    new Date((newYorkServiceBase("2026-11-01") + 43200) * 1000).toISOString(),
    "2026-11-01T17:00:00.000Z",
  );
  assert.equal(at(weekly(), "2026-03-08T16:30:00Z")[0].id, "sunday:2026-03-08");
  assert.equal(at(weekly(), "2026-11-01T17:30:00Z")[0].id, "sunday:2026-11-01");
});

test("spring DST service may start before wall-clock midnight", () => {
  const data = weekly();
  data.trips[2][5] = 1800;
  assert.deepEqual(
    at(data, "2026-03-08T04:45:00Z").map((v) => v.id),
    ["sunday:2026-03-08"],
  );
});

test("trips beyond 48 hours survive month and year transitions", () => {
  const data = weekly();
  data.trips[0][5] = 60 * 3600;
  assert.equal(
    at(data, "2027-01-02T17:30:00Z").some((v) => v.id === "weekday:2026-12-31"),
    true,
  );
});

test("daily materialization is reused, stable within a day, and recomputed after midnight", () => {
  const data = weekly();
  const before = materializeTrips(data, "2026-10-30");
  assert.equal(materializeTrips(data, "2026-10-30"), before);
  assert.notEqual(materializeTrips(data, "2026-10-31"), before);
  assert.equal(
    at(data, "2026-10-30T16:15:00Z")[0].id,
    at(data, "2026-10-30T16:30:00Z")[0].id,
  );
});

test("one fetched bundle contains the same verified assets and templates as direct files", () => {
  const bundle = JSON.parse(
    readFileSync("public/data/transit-bundle.json", "utf8"),
  );
  assert.equal(bundle.version, bundle.assets.version);
  assert.deepEqual(bundle.schedules, schedules);
  assert.deepEqual(
    bundle.assets.network,
    JSON.parse(readFileSync("public/data/network.json", "utf8")),
  );
  assert.deepEqual(
    bundle.assets.metadata,
    JSON.parse(readFileSync("public/data/route-meta.json", "utf8")),
  );
});
