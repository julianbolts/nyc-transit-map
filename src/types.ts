import type { CSSProperties } from "react";
import type { ScheduleData } from "./schedule";
import type { Vehicle } from "./transit-geometry";

export type TransitMode = "subway" | "ferry";
export type TransitSchedules = Record<TransitMode, ScheduleData>;
/** Omit a mode for schedule fallback; [] means the host reports no live vehicles. */
export type LiveVehicles = Partial<Record<TransitMode, readonly Vehicle[]>>;
export interface TransitMapSettings {
  allowPanning: boolean;
  allowZooming: boolean;
  subwayLive: boolean;
  ferryLive: boolean;
}
export const DEFAULT_SETTINGS: Readonly<TransitMapSettings> = Object.freeze({
  allowPanning: false,
  allowZooming: false,
  subwayLive: false,
  ferryLive: false,
});
export interface TransitMapProps {
  schedules: TransitSchedules;
  liveVehicles?: LiveVehicles;
  showSettings?: boolean;
  /** Controlled overrides; update these through onSettingsChange. */
  settings?: Partial<TransitMapSettings>;
  defaultSettings?: Partial<TransitMapSettings>;
  onSettingsChange?: (settings: TransitMapSettings) => void;
  /** Serve the exported assets directory here. Supports subpaths and CDNs. */
  assetBaseUrl?: string;
  /** Host-bundled MapLibre module worker URL. Shared by all MapLibre instances. */
  workerUrl?: string;
  /** Optional separately imported renderer for browsers without WebGL2. Keep this callback stable. */
  loadFallback?: () => Promise<MapRenderer>;
  className?: string;
  style?: CSSProperties;
}
export interface RouteMetadata {
  shapes: Record<string, { mode: TransitMode; route: string }>;
  terminals: {
    id: string;
    name: string;
    lng: number;
    lat: number;
    routes: string[];
  }[];
  stations: { id: string; name: string; lng: number; lat: number }[];
}

/** Adapter constructor surface. Renderer instances implement the MapLibre methods used by the map. */
export interface MapRenderer {
  Map: new (options: any) => unknown;
  Marker: new (options: any) => unknown;
  Popup: new (options?: any) => unknown;
}
