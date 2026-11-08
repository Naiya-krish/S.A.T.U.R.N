/**
 * UIActionExecutor — the single writer of UI state.
 *
 * Human clicks dispatch into here too (origin 'human'), so a click and an agent
 * command can never fight: every action mutates the same Zustand store and the
 * same Three.js scene, and every action returns an explicit result.
 */

import { api } from '../api/client';
import { PRODUCT } from '../config';
import { altitudeForSpan, bboxRings, boundaryRings, parseCoordinates } from '../geo/coords';
import { globe } from '../globe/GlobeController';
import { useSaturnStore } from '../state/useSaturnStore';
import type { Boundary, FireDetection, GeoPoint, LayerInfo, LocationCandidate, OverlayId } from '../state/types';
import { ActionValidationError, parseAction, type ActionType, type ParsedAction } from './schema';

export interface ActionResult {
  status: 'executed' | 'failed' | 'cancelled';
  result?: Record<string, unknown>;
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (args: any, origin: string) => Promise<ActionResult>;

const store = () => useSaturnStore.getState();

const ok = (result: Record<string, unknown> = {}): ActionResult => ({ status: 'executed', result });
const fail = (error: string): ActionResult => ({ status: 'failed', error });

function altitudeForBbox(bbox: [number, number, number, number]): number {
  const latSpan = Math.abs(bbox[2] - bbox[0]);
  const lonSpan = Math.abs(bbox[3] - bbox[1]);
  return altitudeForSpan(latSpan, lonSpan);
}

function currentBbox(): [number, number, number, number] {
  const s = store();
  if (s.highlightedLocation) return s.highlightedLocation.bbox;
  const d = 0.6;
  return [s.camera.lat - d, s.camera.lon - d * 2, s.camera.lat + d, s.camera.lon + d * 2];
}

async function waitForPlan(layerId: string, date: string, timeoutMs = 15000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const s = store();
    if (s.tileStatus === 'ready' && s.tilePlan?.layer_id === layerId && s.tilePlan.date === date) return;
    if (s.tileStatus === 'error') return;
    if (s.tileStatus === 'idle' && !s.layersLoading) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

function regionFromCandidate(c: LocationCandidate, index: number) {
  return {
    id: c.id,
    name: c.name.toUpperCase().slice(0, 22),
    subtitle: (c.country || c.type || 'REGION').toUpperCase(),
    lat: c.lat,
    lon: c.lon,
    bbox: c.bbox,
    status: 'RESOLVED' as const,
    targetNode: `NODE-${String(index + 1).padStart(2, '0')}`,
    mode: 'TRACK',
  };
}

const handlers = { /* typed below via satisfies + identity cast */ } as Record<ActionType, Handler>;
const handlerImpl: Record<ActionType, Handler> = {
  async navigate_globe(args) {
    const lat = Number(args.lat);
    const lon = Number(args.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180)
      return fail('Invalid lat/lon for navigate_globe.');
    const altitude = typeof args.altitude_km === 'number' ? args.altitude_km : Math.min(store().camera.altitudeKm, 9000);
    store().setQuery('');
    globe.flyTo(lat, lon, altitude);
    store().pushLog({ label: 'NAV', kind: 'camera', value: `${lat.toFixed(3)}, ${lon.toFixed(3)} @ ${Math.round(altitude)}km` });
    return ok({ lat, lon, altitude_km: altitude });
  },

  async set_camera_view(args) {
    const phi = typeof args.phi === 'number' ? args.phi : (90 - store().camera.lat) * (Math.PI / 180);
    const theta = typeof args.theta === 'number' ? args.theta : ((store().camera.lon + 180) * Math.PI) / 180;
    globe.setCamera(phi, theta, typeof args.altitude_km === 'number' ? args.altitude_km : undefined, true);
    return ok({ phi, theta });
  },

  async restore_global_view() {
    store().setQuery('');
    globe.resetView();
    store().pushLog({ label: 'VIEW', kind: 'camera', value: 'GLOBAL RESTORE' });
    return ok({});
  },

  async highlight_location(args) {
    const bbox = args.bbox as [number, number, number, number] | undefined;
    const geojson = args.geojson as { type?: string; coordinates?: unknown } | null | undefined;
    const lat = typeof args.lat === 'number' ? args.lat : bbox ? (bbox[0] + bbox[2]) / 2 : undefined;
    const lon = typeof args.lon === 'number' ? args.lon : bbox ? (bbox[1] + bbox[3]) / 2 : undefined;
    if (lat === undefined || lon === undefined) return fail('highlight_location needs lat/lon or a bbox.');
    if (!geojson && !bbox) return fail('highlight_location needs a bbox or geojson outline.');
    let boundary: Boundary | null = null;
    if (geojson && (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon')) {
      boundary = {
        type: geojson.type,
        coordinates: geojson.coordinates,
        is_exact: true,
        note: 'Verified outline (OpenStreetMap ODbL).',
      };
    }
    const candidate: LocationCandidate = {
      id: `hl-${lat.toFixed(3)}-${lon.toFixed(3)}`,
      name: typeof args.name === 'string' ? args.name : `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
      display_name: typeof args.name === 'string' ? args.name : '',
      type: 'highlight',
      lat,
      lon,
      bbox: bbox ?? [lat - 0.5, lon - 0.5, lat + 0.5, lon + 0.5],
      importance: 0,
      score: 0,
      kind: 'coordinate',
    };
    const rings = boundary ? boundaryRings(boundary) : bboxRings(candidate.bbox);
    useSaturnStore.setState({
      highlightedLocation: candidate,
      boundary,
      overlaysProvenance: { ...store().overlaysProvenance, boundaries: boundary ? 'RECENT_OBSERVATION' : 'UNAVAILABLE' },
    });
    if (store().overlays.boundaries) globe.setHighlight({ lat, lon }, rings, candidate.name);
    const s = store();
    const regionIdx = s.regions.findIndex((r) => r.id === candidate.id);
    if (regionIdx > 0) {
      const regions = [...s.regions];
      regions[regionIdx] = { ...regions[regionIdx], ...regionFromCandidate(candidate, regionIdx) };
      useSaturnStore.setState({ regions });
    }
    store().buildLandmarks();
    store().pushLog({
      label: 'GEO',
      kind: 'agent',
      value: `${candidate.name.toUpperCase()} ${boundary ? 'OUTLINE' : 'BBOX'}`,
    });
    return ok({ name: candidate.name, exact_outline: !!boundary });
  },

  async set_imagery_layer(args) {
    const layerId = String(args.layer_id);
    const s = store();
    let layer: LayerInfo | undefined = s.layers.find((l) => l.id === layerId);
    if (!layer) {
      // Unknown locally: ask the backend for metadata (it validates the layer).
      try {
        layer = await api.layer(layerId);
        useSaturnStore.setState({ layers: [...s.layers.filter((l) => l.id !== layer!.id), layer] });
      } catch (e) {
        return fail(e instanceof Error ? e.message : `Could not load layer '${layerId}'.`);
      }
    }
    useSaturnStore.setState({
      activeLayerId: layer.id,
      activeLayerTitle: layer.title,
      dropdowns: { ...s.dropdowns, layer: layer.id },
      tileStatus: 'loading',
      tileError: null,
    });
    let dates = s.latestDates;
    if (!dates.length) dates = await loadDatesFor(layer.id);
    const date = s.observationDate ?? dates[0] ?? null;
    if (!date) {
      useSaturnStore.setState({ dropdowns: { ...store().dropdowns, date: 'LATEST' } });
      return ok({ layer_id: layer.id, date: null, note: 'Layer selected; no observation date yet.' });
    }
    return applyImagery(layer.id, date);
  },

  async set_observation_date(args) {
    const date = String(args.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(`'${date}' is not an ISO date (YYYY-MM-DD).`);
    const s = store();
    if (!s.activeLayerId) {
      useSaturnStore.setState({ observationDate: date, dropdowns: { ...s.dropdowns, date } });
      return ok({ date, note: 'Date set; no layer loaded yet.' });
    }
    return applyImagery(s.activeLayerId, date);
  },

  async set_layer_opacity(args) {
    const value = Math.max(0, Math.min(1, Number(args.value)));
    const s = store();
    useSaturnStore.setState({
      opacity: value,
      sliders: { ...s.sliders, opacity: value },
      dropdowns: s.dropdowns,
    });
    globe.setOpacity(value);
    return ok({ value });
  },

  async toggle_map_overlay(args) {
    const id = args.overlay as OverlayId;
    const s = store();
    const next = !s.overlays[id];
    useSaturnStore.setState({
      overlays: { ...s.overlays, [id]: next },
      checkboxes:
        id in s.checkboxes ? { ...s.checkboxes, [id]: next } : s.checkboxes,
    });
    globe.setOverlay(id, next);
    if (id === 'boundaries') {
      const st = store();
      if (next && st.highlightedLocation) {
        const rings = st.boundary ? boundaryRings(st.boundary) : bboxRings(st.highlightedLocation.bbox);
        globe.setHighlight(st.highlightedLocation, rings, st.highlightedLocation.name);
      } else if (!next) globe.setHighlight(null, [], null);
    }
    store().pushLog({ label: 'OVL', kind: 'layer', value: `${id.toUpperCase()} ${next ? 'ON' : 'OFF'}` });
    return ok({ overlay: id, enabled: next });
  },

  async show_fire_observations(args: Record<string, unknown>): Promise<ActionResult> {
    // Real FIRMS detections -> store -> globe markers. These are thermal
    // anomalies, so every marker is labelled as such rather than as a wildfire.
    const raw = (args.detections as Array<Record<string, unknown>>) ?? [];
    const region = typeof args.region === 'string' ? args.region : null;
    const fires: FireDetection[] = raw
      .filter(
        (d) =>
          typeof d.lat === 'number' &&
          typeof d.lon === 'number' &&
          Number.isFinite(d.lat as number) &&
          Number.isFinite(d.lon as number),
      )
      .map((d, i) => ({
        id: `firms-${i}-${String(d.lat)}-${String(d.lon)}`,
        lat: d.lat as number,
        lon: d.lon as number,
        confidence: (d.confidence as string | null) ?? null,
        satellite: (d.satellite as string | null) ?? null,
        acquisition_time: (d.acquired as string | null) ?? null,
        label: 'THERMAL ANOMALY · NOT A CONFIRMED WILDFIRE',
      }));

    const s = store();
    useSaturnStore.setState({
      fires,
      overlays: { ...s.overlays, fires: fires.length > 0 },
    });
    globe.setFires(fires.map((f) => ({ id: f.id, lat: f.lat, lon: f.lon, confidence: f.confidence ?? null })));
    globe.setOverlay('fires', fires.length > 0);

    store().pushLog({
      label: 'FIRE',
      kind: 'layer',
      value: `${fires.length} ANOMALIES${region ? ` · ${region.toUpperCase()}` : ''}`,
    });
    return ok({ count: fires.length, region, showing: fires.length > 0 });
  },

  async select_dropdown(args: Record<string, unknown>): Promise<ActionResult> {
    const control = String(args.control_id);
    const value = String(args.value);
    const s = store();
    if (control === 'layer') return handlers.set_imagery_layer({ layer_id: value }, 'agent');
    if (control === 'date') {
      const resolved = value === 'LATEST' ? s.latestDates[0] : value;
      if (!resolved) return fail('No available observation date known yet.');
      return handlers.set_observation_date({ date: resolved }, 'agent');
    }
    useSaturnStore.setState({ dropdowns: { ...s.dropdowns, [control]: value } });
    return ok({ control, value });
  },

  async set_slider(args): Promise<ActionResult> {
    const control = String(args.control_id);
    const raw = Number(args.value);
    if (!Number.isFinite(raw)) return fail('Slider value must be numeric.');
    const s = store();
    if (control === 'opacity') return handlers.set_layer_opacity({ value: raw }, 'agent');
    const value = raw > 1 ? raw / 100 : raw;
    useSaturnStore.setState({ sliders: { ...s.sliders, [control]: Math.max(0, Math.min(1, value)) } });
    return ok({ control, value });
  },

  async toggle_checkbox(args) {
    const id = String(args.control_id);
    const s = store();
    if (['boundaries', 'fires', 'events', 'labels', 'grid', 'network', 'night_lights'].includes(id)) {
      return handlers.toggle_map_overlay({ overlay: id }, 'agent');
    }
    const next = !s.checkboxes[id as 'telemetry' | 'auto_refresh'];
    useSaturnStore.setState({ checkboxes: { ...s.checkboxes, [id]: next } });
    return ok({ control: id, enabled: next });
  },

  async open_panel(args) {
    const id = String(args.panel_id) as keyof ReturnType<typeof store>['openPanels'];
    const s = store();
    useSaturnStore.setState({ openPanels: { ...s.openPanels, [id]: true } });
    return ok({ panel: id, open: true });
  },

  async close_panel(args) {
    const id = String(args.panel_id) as keyof ReturnType<typeof store>['openPanels'];
    const s = store();
    useSaturnStore.setState({ openPanels: { ...s.openPanels, [id]: false } });
    return ok({ panel: id, open: false });
  },

  async select_region_card(args) {
    const index = Number(args.index);
    const s = store();
    if (!Number.isInteger(index) || index < 0 || index > 3) return fail('index must be 0..3.');
    const region = s.regions[index];
    if (region.lat === undefined || region.lon === undefined) {
      useSaturnStore.setState({ selectedRegionIndex: index });
      return fail(`Region slot ${index + 1} is empty.`);
    }
    useSaturnStore.setState({ selectedRegionIndex: index });
    globe.flyTo(region.lat, region.lon, region.bbox ? altitudeForBbox(region.bbox) : 6000);
    return ok({ index, name: region.name });
  },

  async save_region(args) {
    const s = store();
    const slot = typeof args.slot === 'number' ? args.slot : Math.min(3, s.regions.findIndex((r) => r.status === 'EMPTY') === -1 ? 3 : s.regions.findIndex((r) => r.status === 'EMPTY'));
    if (!s.highlightedLocation) return fail('Resolve a location before saving a region.');
    const regions = [...s.regions];
    const base = regionFromCandidate(s.highlightedLocation, slot);
    regions[slot] = {
      ...base,
      name: typeof args.name === 'string' ? args.name.toUpperCase().slice(0, 22) : base.name,
    };
    useSaturnStore.setState({ regions, selectedRegionIndex: slot });
    store().buildLandmarks();
    return ok({ slot, name: regions[slot].name });
  },

  async start_timeline_playback(args) {
    const s = store();
    const playing = typeof args.playing === 'boolean' ? args.playing : !s.playback.playing;
    useSaturnStore.setState({
      playback: { playing, stepDays: typeof args.step_days === 'number' ? args.step_days : s.playback.stepDays },
    });
    return ok({ playing });
  },

  async compare_dates(args) {
    const mode = args.mode as 'split' | 'swipe' | 'off';
    const s = store();
    const dateA = (args.date_a as string | undefined) ?? s.observationDate ?? s.latestDates[0] ?? null;
    const dateB = (args.date_b as string | undefined) ?? (s.latestDates[1] ?? null);
    useSaturnStore.setState({ comparison: { mode, dateA, dateB, position: s.comparison.position } });
    globe.setComparison(mode, s.comparison.position);
    return ok({ mode, date_a: dateA, date_b: dateB });
  },

  async focus_event(args) {
    const id = String(args.event_id);
    const s = store();
    const ev = s.events.find((e) => e.id === id);
    const lat = typeof args.lat === 'number' ? args.lat : ev?.lat ?? undefined;
    const lon = typeof args.lon === 'number' ? args.lon : ev?.lon ?? undefined;
    if (lat === undefined || lon === undefined) return fail(`Event '${id}' has no known position.`);
    globe.flyTo(lat, lon, 4200);
    useSaturnStore.setState({
      overlays: { ...s.overlays, events: true },
      openPanels: { ...s.openPanels, events: true },
    });
    globe.setOverlay('events', true);
    return ok({ event_id: id, lat, lon });
  },

  async clear_all() {
    const s = store();
    useSaturnStore.setState({
      activeLayerId: null,
      activeLayerTitle: null,
      observationDate: null,
      tilePlan: null,
      tileStatus: 'idle',
      tileError: null,
      highlightedLocation: null,
      boundary: null,
      comparison: { mode: 'off', dateA: null, dateB: null, position: 0.5 },
      overlays: { boundaries: true, fires: false, events: false, labels: true, grid: true, network: true, night_lights: false },
      regions: [
        { ...s.regions[0], name: 'GLOBAL VIEW', subtitle: 'EARTH / FULL DISK', status: 'RESOLVED' as const },
        ...s.regions.slice(1).map((r) => ({ ...r, status: 'EMPTY' as const })),
      ],
    });
    globe.loadImagery(null);
    globe.setHighlight(null, [], null);
    globe.setEvents([]);
    globe.setFires([]);
    globe.resetView();
    store().pushLog({ label: 'SYS', kind: 'system', value: 'CLEAR ALL' });
    return ok({});
  },

  async inspect_globe_state(): Promise<ActionResult> {
    const snap = globe.snapshot();
    const s = store();
    return ok({
      product: PRODUCT.name,
      camera: snap,
      active_layer: s.activeLayerId,
      layer_title: s.activeLayerTitle,
      observation_date: s.observationDate,
      opacity: s.opacity,
      overlays: s.overlays,
      selected_region: s.regions[s.selectedRegionIndex]?.name ?? null,
      regions: s.regions.map((r) => ({ name: r.name, status: r.status, lat: r.lat, lon: r.lon })),
      open_panels: Object.entries(s.openPanels).filter(([, v]) => v).map(([k]) => k),
      dropdowns: s.dropdowns,
      sliders: s.sliders,
      checkboxes: s.checkboxes,
      playback: s.playback,
      comparison: s.comparison,
      tile_status: s.tileStatus,
      tiles: { loaded: s.tilesLoaded, total: s.tilesTotal },
      agent_stage: s.agent.stage,
    });
  },
};
Object.assign(handlers, handlerImpl);

/** Loads (or re-validates) a layer+date through the backend and pushes to the globe. */
async function applyImagery(layerId: string, date: string): Promise<ActionResult> {
  useSaturnStore.setState({ tileStatus: 'loading', tileError: null });
  try {
    const plan = await api.plan(layerId, date);
    useSaturnStore.setState({
      tilePlan: plan,
      observationDate: plan.date,
      activeLayerId: plan.layer_id,
      activeLayerTitle: plan.title,
      tileStatus: 'ready',
      tileError: null,
      dropdowns: { ...store().dropdowns, layer: plan.layer_id, date: plan.date },
      status: { ...store().status, freshness: plan.provenance.freshness },
    });
    globe.loadImagery({
      layer_id: plan.layer_id,
      date: plan.date,
      tile_template: plan.tile_template,
      max_zoom: plan.max_zoom,
      // Needed by the globe to resolve the {ext} token in the GIBS template.
      format: (plan as { format?: string }).format,
    });
    globe.setOpacity(store().opacity);
    store().pushLog({
      label: 'IMG',
      kind: 'layer',
      value: `${plan.layer_id.split('_').slice(0, 3).join(' ')} ${plan.date}`,
    });
    return ok({ layer_id: plan.layer_id, date: plan.date, tile_template: plan.tile_template, readiness: 'tiles_requested' });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const message = /^\{/.test(raw) ? (JSON.parse(raw).detail ?? JSON.parse(raw).error ?? raw) : raw;
    useSaturnStore.setState({ tileStatus: 'error', tileError: message });
    return fail(message);
  }
}

/** Wires layer-list + date-list refresh after a layer selection (used by UI + agent). */
export async function ensureLayerCatalog(): Promise<void> {
  const s = store();
  if (s.layers.length) return;
  try {
    const res = await api.layers();
    useSaturnStore.setState({ layers: res.layers, layersLoading: false, layersError: null });
  } catch (e) {
    useSaturnStore.setState({ layersLoading: false, layersError: e instanceof Error ? e.message : String(e) });
  }
}

export async function loadDatesFor(layerId: string): Promise<string[]> {
  try {
    const res = await api.dates(layerId, 21);
    const dates = res.dates.filter((d) => d.available).map((d) => d.date);
    useSaturnStore.setState({ latestDates: dates, dropdowns: { ...store().dropdowns, date: 'LATEST' } });
    return dates;
  } catch {
    return [];
  }
}

export const uiActions = {
  /** Executes a validated action and reports a truthful status. */
  async execute(raw: { action_id?: string; type?: unknown; args?: unknown; origin?: string }): Promise<ActionResult & { action_id?: string; type?: string }> {
    const actionId = raw.action_id;
    let parsed: ParsedAction;
    try {
      parsed = parseAction(raw);
    } catch (e) {
      const err = e as ActionValidationError;
      return { status: 'failed', error: err.message, action_id: actionId, type: String(raw.type) };
    }
    const s = store();
    if (s.agent.taskId === null && raw.origin === 'agent') {
      // still allowed (debug console) but nothing to cancel
    }
    try {
      const handler = handlers[parsed.type] as Handler;
      const res = await handler(parsed.args, raw.origin ?? 'human');
      return { ...res, action_id: actionId, type: parsed.type };
    } catch (e) {
      return {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
        action_id: actionId,
        type: parsed.type,
      };
    }
  },

  /** Human-originated UI change (button, slider, dropdown). Same executor. */
  human<T extends ActionType>(type: T, args: ParsedAction<T>['args']): Promise<ActionResult> {
    return uiActions.execute({ type, args, origin: 'human', action_id: `h-${Math.random().toString(36).slice(2, 9)}` });
  },

  /** Debug console entry point. */
  debug(type: string, args: Record<string, unknown>): Promise<ActionResult> {
    return uiActions.execute({ type, args, origin: 'debug', action_id: `d-${Math.random().toString(36).slice(2, 9)}` });
  },

  waitForPlan,
  currentBbox,
  applyImagery,
  regionFromCandidate,
};

/** Search helper shared by the search box and the agent (resolves via backend). */
export async function resolveAndHighlight(query: string): Promise<{ ok: boolean; message: string }> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, message: 'Enter a place name or "lat, lon".' };
  try {
    parseCoordinates(trimmed);
  } catch {
    useSaturnStore.getState().addMessage({ role: 'system', kind: 'error', text: 'Invalid coordinates. Latitude must be -90..90 and longitude -180..180.' });
    useSaturnStore.setState({ resolveStatus: 'invalid' });
    return { ok: false, message: 'Invalid coordinates.' };
  }
  useSaturnStore.setState({ resolveStatus: 'searching', query: trimmed });
  try {
    const res = await api.resolve(trimmed);
    useSaturnStore.setState({ candidates: res.candidates.slice(0, 6), resolveWarnings: res.warnings });
    if (res.status !== 'resolved' || !res.best) {
      useSaturnStore.setState({ resolveStatus: res.status === 'ambiguous' ? 'ambiguous' : res.status === 'invalid' ? 'invalid' : 'not_found' });
      return {
        ok: false,
        message:
          res.status === 'ambiguous'
            ? `Ambiguous: ${res.candidates.slice(0, 4).map((c) => `${c.name} (${c.country ?? '?'})`).join(', ')}`
            : res.warnings[0] ?? 'Location not found.',
      };
    }
    const best = res.best;
    useSaturnStore.setState({ resolveStatus: 'resolved', resolveWarnings: res.warnings });
    await uiActions.execute({
      action_id: `geo-${Date.now()}`,
      origin: 'human',
      type: 'highlight_location',
      args: {
        name: best.name,
        lat: best.lat,
        lon: best.lon,
        bbox: best.bbox,
        geojson: res.boundary?.is_exact ? res.boundary : null,
      },
    });
    const st = store();
    const regions = [...st.regions];
    const empty = regions.findIndex((r) => r.status === 'EMPTY');
    const slot = empty >= 0 ? empty : 1;
    regions[slot] = { ...regionFromCandidate(best, slot) };
    useSaturnStore.setState({ regions, selectedRegionIndex: slot, boundary: res.boundary, highlightedLocation: best });
    store().buildLandmarks();
    const alt = altitudeForBbox(best.bbox);
    globe.flyTo(best.lat, best.lon, alt);
    return { ok: true, message: `${best.name}${best.country ? `, ${best.country}` : ''}` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    useSaturnStore.setState({ resolveStatus: 'not_found', resolveWarnings: [message] });
    return { ok: false, message };
  }
}

export function geolocateUser(): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation is not supported by this browser.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(new Error(err.message)),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  });
}
