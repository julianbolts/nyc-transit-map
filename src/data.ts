import { cachedJSON } from "./client-cache";
import type { TransitSchedules } from "./types";
import type { ScheduleData } from "./schedule";
export { scheduledVehicles, newYorkDate } from "./schedule";
/** Mock API for containers. Reads CI-generated files, never contacts transit agencies. */
export async function loadMockSchedules(
  assetBaseUrl = new URL(/* @vite-ignore */ "./assets/", import.meta.url).href,
): Promise<TransitSchedules> {
  const base = assetBaseUrl.replace(/\/?$/, "/");
  const [subway, ferry] = await Promise.all([
    cachedJSON<ScheduleData>(base + "data/subway-schedule.json", 60),
    cachedJSON<ScheduleData>(base + "data/ferry-schedule.json", 60),
  ]);
  return { subway, ferry };
}
