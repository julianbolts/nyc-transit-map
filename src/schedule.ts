import type { Vehicle } from "./transit-geometry";
export type ScheduleData = {
  version: string;
  sources: Record<string, { downloaded: string; url?: string }>;
  stops: Record<string, [string, number, number]>;
  routes: Record<string, [string, string, "subway" | "ferry"]>;
  patterns: [string, number, number, number][][];
  trips: [string, string, string, string, number, number, number][];
  validUntil: number;
  date: string;
};
export function scheduledVehicles(
  data: ScheduleData,
  now = Date.now() / 1000,
): Vehicle[] {
  const result: Vehicle[] = [];
  for (const [id, route, headsign, shape, pattern, start, base] of data.trips) {
    const times = data.patterns[pattern];
    if (
      base + start + times[0][2] > now ||
      base + start + times[times.length - 1][2] < now
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
      mode: data.routes[route][2] as Vehicle["mode"],
      stops,
      live: false,
    });
  }
  return result;
}
export function newYorkDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

import type { TransitSchedules, LiveVehicles, TransitMode } from "./types";
/** Pure reconciliation: omitted live modes fall back, explicit empty modes clear markers. */
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
      if (enabled[mode]) status[mode] = "Live unavailable · using schedule";
      if (now >= schedule.validUntil) {
        expired.push(mode);
        status[mode] = "Schedule snapshot expired";
        continue;
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
