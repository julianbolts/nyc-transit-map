import type { Vehicle } from "./transit-geometry";
import type { TransitSchedules, LiveVehicles, TransitMode } from "./types";

type Timetable = {
  version: string;
  sources: Record<
    string,
    {
      downloaded: string;
      url?: string;
      feedVersion?: string;
      startDate?: string;
      endDate?: string;
    }
  >;
  stops: Record<string, [string, number, number]>;
  routes: Record<string, [string, string, "subway" | "ferry"]>;
  patterns: [string, number, number, number][][];
};
export type DatedScheduleData = Timetable & {
  kind?: "snapshot";
  trips: [string, string, string, string, number, number, number][];
  validUntil: number;
  date: string;
};
/** Monday through Sunday, each referencing a shared timetable variant. */
export type WeekVariants = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
export type WeeklyScheduleData = Timetable & {
  schemaVersion: 2;
  kind: "weekly-template";
  timezone: "America/New_York";
  generatedAt: string;
  refreshAfter: number;
  trips: [string, string, string, string, number, number][];
  variants: Record<string, number[]>;
  periods: { from: string; through: string; week: WeekVariants }[];
  fallbackWeek: WeekVariants;
  quality: { notes: string[] };
};
export type ScheduleData = DatedScheduleData | WeeklyScheduleData;

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const clockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
export function newYorkDate(now = new Date()) {
  return dateFormatter.format(now);
}
/** GTFS noon minus twelve elapsed hours, including DST transition days. */
export function newYorkServiceBase(day: string) {
  const utcNoon = Date.parse(day + "T12:00:00Z");
  const fields = Object.fromEntries(
    clockFormatter
      .formatToParts(new Date(utcNoon))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const offset =
    Date.UTC(
      fields.year,
      fields.month - 1,
      fields.day,
      fields.hour,
      fields.minute,
      fields.second,
    ) - utcNoon;
  return (utcNoon - offset) / 1000 - 43200;
}

const materialized = new WeakMap<
  WeeklyScheduleData,
  { day: string; trips: DatedScheduleData["trips"] }
>();
/** Rebase once per New York date. No network request or refresh is needed at midnight. */
export function materializeTrips(
  data: WeeklyScheduleData,
  day: string,
): DatedScheduleData["trips"] {
  const cached = materialized.get(data);
  if (cached?.day === day) return cached.trips;
  const maxEnd = data.trips.reduce(
    (end, trip) => Math.max(end, trip[5] + data.patterns[trip[4]].at(-1)![2]),
    0,
  );
  const lookback = Math.ceil(maxEnd / 86400) + 1;
  const trips: DatedScheduleData["trips"] = [];
  // Include tomorrow: on spring DST day the GTFS service base is 23:00 the night before.
  for (let offset = -lookback; offset <= 1; offset++) {
    const date = new Date(day + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() + offset);
    const serviceDate = date.toISOString().slice(0, 10);
    let week = data.fallbackWeek;
    for (const period of data.periods) {
      if (period.from > serviceDate) break;
      // Gaps and dates beyond coverage continue the most recent usable season.
      week = period.week;
      if (serviceDate <= period.through) break;
    }
    const variant = week[(date.getUTCDay() + 6) % 7];
    const base = newYorkServiceBase(serviceDate);
    for (const index of data.variants[variant]) {
      const [id, route, headsign, shape, pattern, start] = data.trips[index];
      trips.push([
        `${id}:${serviceDate}`,
        route,
        headsign,
        shape,
        pattern,
        start,
        base,
      ]);
    }
  }
  materialized.set(data, { day, trips });
  return trips;
}

export function scheduledVehicles(
  data: ScheduleData,
  now = Date.now() / 1000,
): Vehicle[] {
  const result: Vehicle[] = [];
  const typical = data.kind === "weekly-template";
  const trips = typical
    ? materializeTrips(data, newYorkDate(new Date(now * 1000)))
    : data.trips;
  for (const [id, route, headsign, shape, pattern, start, base] of trips) {
    const times = data.patterns[pattern];
    if (
      base + start + times[0][2] > now ||
      base + start + times.at(-1)![2] < now
    )
      continue;
    const stops = times.map(([id, a, d, sequence]) => ({
      id,
      name: data.stops[id][0],
      lng: data.stops[id][1],
      lat: data.stops[id][2],
      arrival: base + start + a,
      departure: base + start + d,
      sequence,
    }));
    if (
      !stops.some(
        (s) =>
          s.lat > 40.64 && s.lat < 40.83 && s.lng > -74.06 && s.lng < -73.9,
      )
    )
      continue;
    result.push({
      id,
      route: data.routes[route][0],
      headsign: headsign || stops.at(-1)!.name,
      shape,
      mode: data.routes[route][2],
      stops,
      live: false,
      ...(typical ? { typical: true } : {}),
    });
  }
  return result;
}

/** Omitted live modes fall back; explicit empty modes clear markers. */
export function resolveVehicles(
  schedules: TransitSchedules,
  live: LiveVehicles | undefined,
  enabled: Record<TransitMode, boolean>,
  now = Date.now() / 1000,
) {
  const vehicles: Vehicle[] = [];
  const status = { subway: "Scheduled", ferry: "Scheduled" };
  const expired: TransitMode[] = [];
  for (const mode of ["subway", "ferry"] as const) {
    const schedule = schedules[mode];
    if (enabled[mode] && live?.[mode] !== undefined) {
      vehicles.push(...live[mode]!.filter((vehicle) => vehicle.mode === mode));
      status[mode] =
        mode === "subway"
          ? "Live arrivals · estimated positions"
          : "Live ferry data";
    } else {
      if (schedule.kind === "weekly-template") {
        status[mode] =
          now > schedule.refreshAfter + 7 * 86400
            ? "Typical schedule · older template"
            : "Typical schedule";
        if (enabled[mode])
          status[mode] = `Live unavailable · ${status[mode].toLowerCase()}`;
      } else {
        if (enabled[mode]) status[mode] = "Live unavailable · using schedule";
        if (now >= schedule.validUntil) {
          expired.push(mode);
          status[mode] = "Schedule snapshot expired";
          continue;
        }
      }
      vehicles.push(
        ...scheduledVehicles(schedule, now).filter(
          (vehicle) => vehicle.mode === mode,
        ),
      );
    }
  }
  return {
    vehicles,
    status,
    notice: expired.length
      ? `The ${expired.join(" and ")} schedule snapshot has expired. Provide a current timetable.`
      : undefined,
  };
}
