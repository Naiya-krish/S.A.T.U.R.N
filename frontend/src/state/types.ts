/** Shared domain types (mirror of backend/app/models.py). */

export type Freshness =
  | 'RECENT_OBSERVATION'
  | 'HISTORICAL'
  | 'FORECAST'
  | 'STALE'
  | 'UNAVAILABLE';

export interface Provenance {
  provider: string;
  product: string;
  observation_time?: string | null;
  retrieval_time: string;
  freshness: Freshness;
  attribution?: string | null;
  source_url?: string | null;
  note?: string | null;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface LocationCandidate {
  id: string;
  name: string;
  display_name: string;
  type: string;
  category?: string | null;
  country?: string | null;
  country_code?: string | null;
  lat: number;
  lon: number;
  bbox: [number, number, number, number];
  importance: number;
  score: number;
  kind: 'location' | 'coordinate';
}

export interface Boundary {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: unknown;
  is_exact: boolean;
  note: string;
}

export interface ResolveResponse {
  query: string;
  status: 'resolved' | 'ambiguous' | 'not_found' | 'invalid';
  needs_clarification: boolean;
  best: LocationCandidate | null;
  candidates: LocationCandidate[];
  boundary: Boundary | null;
  context: Record<string, unknown>;
  warnings: string[];
  provenance: Provenance;
}

export interface LayerInfo {
  id: string;
  title: string;
  format: string;
  projection: string;
  tile_matrix_set: string;
  temporal_start?: string | null;
  temporal_end?: string | null;
  temporal_period?: string | null;
  attribution: string;
  supported: boolean;
}

export interface TilePlan {
  provider: string;
  layer_id: string;
  title: string;
  date: string;
  projection: string;
  tile_matrix_set: string;
  tile_template: string;
  format: string;
  max_zoom: number;
  attribution: string;
  provenance: Provenance;
  warnings: string[];
}

export type OverlayId =
  | 'boundaries'
  | 'fires'
  | 'events'
  | 'labels'
  | 'grid'
  | 'network'
  | 'night_lights';

export type PanelId = 'layers' | 'events' | 'sources' | 'history' | 'settings' | 'chat';

export interface RegionSlot {
  id: string;
  name: string;
  subtitle: string;
  lat?: number;
  lon?: number;
  bbox?: [number, number, number, number];
  status: 'LOCKED' | 'EMPTY' | 'RESOLVED' | 'AMBIGUOUS';
  targetNode: string;
  mode: string;
}

export interface EarthEvent {
  id: string;
  category: string;
  title: string;
  lat?: number | null;
  lon?: number | null;
  time?: string | null;
  status: string;
  source_link?: string | null;
  provenance?: Provenance | null;
}

export interface FireDetection {
  id: string;
  lat: number;
  lon: number;
  brightness_k?: number | null;
  confidence?: string | null;
  frp_mw?: number | null;
  satellite?: string | null;
  instrument?: string | null;
  acquisition_time?: string | null;
  daynight?: string | null;
  label: string;
}

export interface ServiceStatus {
  backend: 'ONLINE' | 'OFFLINE' | 'CHECKING';
  vertex: 'READY' | 'MOCK' | 'UNAVAILABLE';
  network: 'ONLINE' | 'OFFLINE';
  freshness: Freshness;
  activeTasks: number;
  latencyMs: number | null;
  agentMode: 'vertex' | 'mock' | 'unknown';
  firms: boolean;
}

export interface TaskActionTrace {
  action_id: string;
  type: string;
  status: 'accepted' | 'executed' | 'failed' | 'cancelled';
  error?: string | null;
}

export interface AgentMessage {
  id: string;
  role: 'operator' | 'assistant' | 'system';
  text: string;
  ts: number;
  kind?: 'info' | 'error' | 'result';
}
