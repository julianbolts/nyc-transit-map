import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  resolveVehicles,
  scheduledVehicles,
  newYorkDate,
} from "../src/schedule.ts";
import type { TransitSchedules } from "../src/types.ts";
import type { Vehicle } from "../src/transit-geometry.ts";
const schedules: TransitSchedules = {
  subway: JSON.parse(readFileSync("public/data/subway-schedule.json", "utf8")),
  ferry: JSON.parse(readFileSync("public/data/ferry-schedule.json", "utf8")),
};
const noon = new Date(schedules.subway.date + "T16:00:00Z").getTime() / 1000;

test("official snapshots include both modes and valid geometry/stop references", () => {
  const network = JSON.parse(readFileSync("public/data/network.json", "utf8"));
  for (const mode of ["subway", "ferry"] as const) {
    const data = schedules[mode];
    assert.ok(data.trips.length > 0);
    assert.ok(data.validUntil > noon);
    for (const [, route, , shape, pattern] of data.trips) {
      assert.equal(data.routes[route][2], mode);
      assert.ok(network.shapes[shape]);
      assert.ok(data.patterns[pattern].length >= 2);
      for (const [stop] of data.patterns[pattern]) assert.ok(data.stops[stop]);
    }
    assert.ok(scheduledVehicles(data, noon).length > 0);
  }
});
test("an unavailable live mode falls back independently and [] means no vehicles", () => {
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
  assert.equal(result.status.subway, "Live unavailable · using schedule");
  const cleared = resolveVehicles(
    schedules,
    { ferry: [] },
    { subway: false, ferry: true },
    noon,
  );
  assert.ok(cleared.vehicles.length > 0);
  assert.ok(cleared.vehicles.every((v) => v.mode === "subway"));
});
test("disabled live settings use timetables even when host provides live vehicles", () => {
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
test("expired snapshot is explicit and does not masquerade as current data", () => {
  const now =
    Math.max(schedules.subway.validUntil, schedules.ferry.validUntil) + 1;
  const result = resolveVehicles(
    schedules,
    undefined,
    { subway: false, ferry: false },
    now,
  );
  assert.equal(result.vehicles.length, 0);
  assert.match(result.notice!, /expired/);
});
test("New York service date differs from UTC after midnight UTC", () => {
  assert.equal(newYorkDate(new Date("2026-09-30T02:00:00Z")), "2026-09-29");
});

test("the snapshot bridges New York midnight before nightly CI runs", () => {
  const nextDay = new Date(schedules.subway.date + "T12:00:00Z");
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const result = resolveVehicles(
    schedules,
    undefined,
    { subway: false, ferry: false },
    nextDay.getTime() / 1000,
  );
  assert.equal(result.notice, undefined);
  assert.ok(result.vehicles.some((v) => v.mode === "subway"));
  assert.ok(result.vehicles.some((v) => v.mode === "ferry"));
});
