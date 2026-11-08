/**
 * Single source of truth for the whole console.
 * Humans (panel controls) and the agent (UIActionExecutor) both write here.
 */

import { create } from 'zustand';
import type {
  AgentMessage,
  Boundary,
  EarthEvent,
  FireDetection,
  Freshness,
  GeoPoint,
  LayerInfo,
  LocationCandidate,
  OverlayId,
  PanelId,
  Provenance,
  RegionSlot,
  ServiceStatus,
  TaskActionTrace,
  TilePlan,
} from './types';
import { altitudeForSpan, bboxRings, boundaryRings } from '../geo/coords';

export interface CameraState {
  lat: number;
  lon: number;
  altitudeKm: number;
}

export interface ComparisonState {
  mode: 'split' | 'swipe' | 'off';
  dateA: string | null;
  dateB: string | null;
  position: number;
}

export interface TraceLine {
  id: string;
  ts: number;
  label: string;
  kind: 'camera' | 'layer' | 'agent' | 'alert' | 'system';
  value: string;
}

export interface Landmark {
  name: string;
  lat: number;
  lon: number;
  lonSpan: number;
}

export interface SaturnState {
  booted: boolean;
  timezone: string;

  status: ServiceStatus;
  camera: CameraState;
  animatingCamera: boolean;

  layers: LayerInfo[];
  layersLoading: boolean;
  layersError: string | null;
  activeLayerId: string | null;
  activeLayerTitle: string | null;
  observationDate: string | null;
  latestDates: string[];
  opacity: number;
  tilePlan: TilePlan | null;
  tileStatus: 'idle' | 'loading' | 'ready' | 'error';
  tileError: string | null;
  tilesLoaded: number;
  tilesTotal: number;

  overlays: Record<OverlayId, boolean>;
  comparison: ComparisonState;
  playback: { playing: boolean; stepDays: number };

  highlightedLocation: LocationCandidate | null;
  boundary: Boundary | null;
  regionGroups: { group: string; items: { label: string; value: string }[] }[];
  resolveStatus: 'idle' | 'searching' | 'resolved' | 'ambiguous' | 'not_found' | 'invalid';
  resolveWarnings: string[];
  candidates: LocationCandidate[];
  query: string;

  regions: RegionSlot[];
  selectedRegionIndex: number;
  landmarks: Landmark[];

  events: EarthEvent[];
  fires: FireDetection[];
  eventsProvenance: Provenance | null;
  firesProvenance: Provenance | null;
  overlaysProvenance: Record<OverlayId, Freshness>;

  messages: AgentMessage[];
  openPanels: Record<PanelId, boolean>;
  sliders: { opacity: number; timeline: number; exposure: number; gain: number };
  dropdowns: { layer: string; product: string; projection: string; date: string; cadence: string };
  checkboxes: Record<'telemetry' | 'auto_refresh', boolean>;

  agent: {
    taskId: string | null;
    stage: 'idle' | 'thinking' | 'acting' | 'speaking';
    trace: TaskActionTrace[];
    lastTool: string | null;
    error: string | null;
    modeNoted?: boolean;
  };
  logs: TraceLine[];
  activeTasks: number;

  setCamera: (c: Partial<CameraState>) => void;
  setTimezone: (tz: string) => void;
  setBooted: (v: boolean) => void;
  setStatus: (s: Partial<ServiceStatus>) => void;
  setQuery: (q: string) => void;
  pushLog: (line: Omit<TraceLine, 'id' | 'ts'> & { ts?: number }) => void;
  setLayers: (layers: LayerInfo[], error?: string | null) => void;
  addMessage: (m: Omit<AgentMessage, 'id' | 'ts'> & { ts?: number }) => void;
  setActiveTasks: (n: number) => void;
  buildLandmarks: () => void;
}

let logSeq = 0;
let msgSeq = 0;

const defaultLayers: LayerInfo[] = [];
const EMPTY_REGION = (i: number): RegionSlot => ({
  id: `slot-${i}`,
  name: i === 0 ? 'GLOBAL VIEW' : `REGION SLOT ${String(i + 1).padStart(2, '0')}`,
  subtitle: i === 0 ? 'EARTH / FULL DISK' : 'UNASSIGNED',
  status: i === 0 ? 'RESOLVED' : 'EMPTY',
  targetNode: i === 0 ? 'SATURN-00' : `NODE-${String(i + 1).padStart(2, '0')}`,
  mode: 'PASSIVE',
});

export const useSaturnStore = create<SaturnState>((set, get) => ({
  booted: false,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',

  status: {
    backend: 'CHECKING',
    vertex: 'UNAVAILABLE',
    network: typeof navigator !== 'undefined' && navigator.onLine ? 'ONLINE' : 'OFFLINE',
    freshness: 'UNAVAILABLE',
    activeTasks: 0,
    latencyMs: null,
    agentMode: 'unknown',
    firms: false,
  },
  camera: { lat: 22.4, lon: 10.2, altitudeKm: 16200 },
  animatingCamera: false,

  layers: defaultLayers,
  layersLoading: false,
  layersError: null,
  activeLayerId: null,
  activeLayerTitle: null,
  observationDate: null,
  latestDates: [],
  opacity: 0.92,
  tilePlan: null,
  tileStatus: 'idle',
  tileError: null,
  tilesLoaded: 0,
  tilesTotal: 0,

  overlays: {
    boundaries: true,
    fires: false,
    events: false,
    labels: true,
    grid: true,
    network: true,
    night_lights: false,
  },
  comparison: { mode: 'off', dateA: null, dateB: null, position: 0.5 },
  playback: { playing: false, stepDays: 1 },

  highlightedLocation: null,
  boundary: null,
  regionGroups: [],
  resolveStatus: 'idle',
  resolveWarnings: [],
  candidates: [],
  query: '',

  regions: [EMPTY_REGION(0), EMPTY_REGION(1), EMPTY_REGION(2), EMPTY_REGION(3)],
  selectedRegionIndex: 0,
  landmarks: [],

  events: [],
  fires: [],
  eventsProvenance: null,
  firesProvenance: null,
  overlaysProvenance: {
    boundaries: 'UNAVAILABLE',
    fires: 'UNAVAILABLE',
    events: 'UNAVAILABLE',
    labels: 'UNAVAILABLE',
    grid: 'UNAVAILABLE',
    network: 'UNAVAILABLE',
    night_lights: 'UNAVAILABLE',
  },

  messages: [],
  openPanels: { layers: false, events: false, sources: false, history: false, settings: false, chat: false },
  sliders: { opacity: 0.92, timeline: 0.68, exposure: 0.46, gain: 0.54 },
  dropdowns: { layer: 'AUTO', product: 'AUTO', projection: 'EPSG:3857', date: 'LATEST', cadence: 'DAILY' },
  checkboxes: { telemetry: true, auto_refresh: true },

  agent: { taskId: null, stage: 'idle', trace: [], lastTool: null, error: null },
  logs: [],
  activeTasks: 0,

  setCamera: (c) => set((s) => ({ camera: { ...s.camera, ...c } })),
  setTimezone: (timezone) => set({ timezone }),
  setBooted: (booted) => set({ booted }),
  setStatus: (s) => set((st) => ({ status: { ...st.status, ...s } })),
  setQuery: (query) => set({ query }),
  pushLog: (line) =>
    set((s) => ({
      logs: [
        ...s.logs.slice(-40),
        { id: `log-${++logSeq}`, ts: line.ts ?? Date.now(), label: line.label, kind: line.kind, value: line.value },
      ],
    })),
  setLayers: (layers, error = null) => set({ layers, layersError: error, layersLoading: false }),
  addMessage: (m) =>
    set((s) => ({
      messages: [...s.messages.slice(-30), { ...m, id: `msg-${++msgSeq}`, ts: m.ts ?? Date.now() }],
    })),
  setActiveTasks: (n) => set({ activeTasks: n, status: { ...get().status, activeTasks: n } }),
  buildLandmarks: () => {
    const s = get();
    const items: Landmark[] = [];
    const push = (c: LocationCandidate) => {
      const lonSpan = c.bbox[3] >= c.bbox[1] ? c.bbox[3] - c.bbox[1] : 360 - c.bbox[1] + c.bbox[3];
      items.push({ name: c.name, lat: c.lat, lon: c.lon, lonSpan });
    };
    if (s.highlightedLocation) push(s.highlightedLocation);
    s.regions.forEach((r) => {
      if (r.lat !== undefined && r.lon !== undefined && r.name !== 'GLOBAL VIEW') {
        items.push({ name: r.name, lat: r.lat, lon: r.lon, lonSpan: r.bbox ? Math.abs(r.bbox[3] - r.bbox[1]) : 8 });
      }
    });
    set({ landmarks: items.slice(0, 8) });
  },
}));

/** Outline rings for the store's active highlight (boundary polygon or bbox). */
export function selectHighlightRings(state: SaturnState): [number, number][][] {
  if (state.boundary) {
    const rings = boundaryRings(state.boundary);
    if (rings.length) return rings;
  }
  if (state.highlightedLocation) return bboxRings(state.highlightedLocation.bbox);
  return [];
}

export function selectAltitudeFor(state: SaturnState): number {
  const loc = state.highlightedLocation;
  if (!loc) return 16200;
  const latSpan = Math.abs(loc.bbox[2] - loc.bbox[0]);
  const lonSpan = Math.abs(loc.bbox[3] - loc.bbox[1]);
  return altitudeForSpan(latSpan, lonSpan);
}

export function cameraToReadout(c: CameraState): GeoPoint {
  return { lat: c.lat, lon: c.lon };
}
