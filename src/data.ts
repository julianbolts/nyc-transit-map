import { cachedJSON } from "./client-cache";
import type { TransitSchedules } from "./types";
export { scheduledVehicles, newYorkDate } from "./schedule";

type TransitBundle = {
  schemaVersion: 1;
  version: string;
  schedules: Pick<TransitSchedules, "subway" | "ferry">;
  assets: NonNullable<TransitSchedules["assets"]>;
};
const loaded = new Map<string, { version: string; value: TransitSchedules }>();
function validBundle(bundle: TransitBundle) {
  return (
    bundle?.schemaVersion === 1 &&
    typeof bundle.version === "string" &&
    bundle.version === bundle.assets?.version &&
    Array.isArray(bundle.assets?.network?.edges) &&
    !!bundle.assets?.metadata?.shapes &&
    bundle.schedules?.subway?.kind === "weekly-template" &&
    bundle.schedules?.ferry?.kind === "weekly-template"
  );
}
/** One static response keeps timetables, metadata and verified paths consistent. */
export async function loadMockSchedules(
  assetBaseUrl = new URL(/* @vite-ignore */ "./assets/", import.meta.url).href,
): Promise<TransitSchedules> {
  const base = assetBaseUrl.replace(/\/?$/, "/");
  const bundle = await cachedJSON<TransitBundle>(
    base + "data/transit-bundle.json",
    60,
    { staleIfError: true, revalidate: true, validate: validBundle },
  );
  const hit = loaded.get(base);
  if (hit?.version === bundle.version) return hit.value;
  const schedules = { ...bundle.schedules, assets: bundle.assets };
  loaded.set(base, { version: bundle.version, value: schedules });
  return schedules;
}
