/**
 * Typed UI Action schema (Zod). This is the contract shared with the backend
 * (app/ui_actions/registry.py). One command system for humans and the agent.
 */

import { z } from 'zod';

export const OverlayEnum = z.enum([
  'boundaries',
  'fires',
  'events',
  'labels',
  'grid',
  'network',
  'night_lights',
]);

export const PanelEnum = z.enum(['layers', 'events', 'sources', 'history', 'settings', 'chat']);

const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);
const bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const UIActionArgsSchema = z.object({
  navigate_globe: z.object({
    lat,
    lon,
    altitude_km: z.number().min(200).max(40000).optional(),
  }),
  set_camera_view: z.object({
    phi: z.number().optional(),
    theta: z.number().optional(),
    altitude_km: z.number().min(200).max(40000).optional(),
  }),
  restore_global_view: z.object({}).strict(),
  highlight_location: z.object({
    name: z.string().optional(),
    lat: lat.optional(),
    lon: lon.optional(),
    bbox: bbox.optional(),
    geojson: z.union([z.record(z.unknown()), z.null()]).optional(),
  }),
  set_imagery_layer: z.object({ layer_id: z.string().min(1) }),
  set_observation_date: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  set_layer_opacity: z.object({ value: z.number().min(0).max(1) }),
  toggle_map_overlay: z.object({ overlay: OverlayEnum }),
  select_dropdown: z.object({
    control_id: z.enum(['layer', 'product', 'projection', 'date', 'cadence']),
    value: z.string().min(1),
  }),
  set_slider: z.object({
    control_id: z.enum(['opacity', 'timeline', 'exposure', 'gain']),
    value: z.number(),
  }),
  toggle_checkbox: z.object({
    control_id: z.enum(['boundaries', 'fires', 'events', 'labels', 'grid', 'network', 'telemetry', 'auto_refresh']),
  }),
  open_panel: z.object({ panel_id: PanelEnum }),
  close_panel: z.object({ panel_id: PanelEnum }),
  select_region_card: z.object({
    index: z.number().int().min(0).max(3),
    region_id: z.string().optional(),
  }),
  save_region: z.object({
    slot: z.number().int().min(0).max(3).optional(),
    name: z.string().optional(),
  }),
  start_timeline_playback: z.object({
    playing: z.boolean().optional(),
    step_days: z.number().int().min(1).max(30).optional(),
  }),
  compare_dates: z.object({
    mode: z.enum(['split', 'swipe', 'off']),
    date_a: z.string().optional(),
    date_b: z.string().optional(),
  }),
  focus_event: z.object({ event_id: z.string().min(1), lat: lat.optional(), lon: lon.optional() }),
  /** Push real FIRMS detections onto the globe (thermal anomalies, not wildfires). */
  show_fire_observations: z.object({
    detections: z
      .array(
        z.object({
          lat: lat,
          lon: lon,
          confidence: z.string().nullish(),
          satellite: z.string().nullish(),
          acquired: z.string().nullish(),
        }),
      )
      .max(5000),
    region: z.string().optional(),
  }),
  clear_all: z.object({}).strict(),
  inspect_globe_state: z.object({}).strict(),
});

export type ActionType = keyof z.infer<typeof UIActionArgsSchema>;
type InferredActions = z.infer<typeof UIActionArgsSchema>;
export type ActionArgs<T extends ActionType> = InferredActions[T];

export const ACTION_TYPES: ActionType[] = [
  'navigate_globe',
  'set_camera_view',
  'restore_global_view',
  'highlight_location',
  'set_imagery_layer',
  'set_observation_date',
  'set_layer_opacity',
  'toggle_map_overlay',
  'select_dropdown',
  'set_slider',
  'toggle_checkbox',
  'open_panel',
  'close_panel',
  'select_region_card',
  'save_region',
  'start_timeline_playback',
  'compare_dates',
  'focus_event',
  'show_fire_observations',
  'clear_all',
  'inspect_globe_state',
];

export const UIActionEnvelope = z.object({
  action_id: z.string().min(1),
  type: z.string(),
  args: z.record(z.unknown()).default({}),
  status: z.enum(['accepted', 'executed', 'failed', 'cancelled']).default('accepted'),
  origin: z.enum(['agent', 'human', 'debug']).default('agent'),
});

export type UIActionEnvelopeT = z.infer<typeof UIActionEnvelope>;

export interface ParsedAction<T extends ActionType = ActionType> {
  type: T;
  args: ActionArgs<T>;
}

export class ActionValidationError extends Error {
  constructor(public readonly actionType: string, public readonly issues: string[]) {
    super(`Invalid action '${actionType}': ${issues.join('; ')}`);
  }
}

/** Validates an incoming action (from SSE or the debug console). Throws on bad input. */
export function parseAction(raw: { type?: unknown; args?: unknown }): ParsedAction {
  const type = raw?.type;
  if (typeof type !== 'string' || !(ACTION_TYPES as string[]).includes(type)) {
    throw new ActionValidationError(String(type), ['unknown action type']);
  }
  const shapes = UIActionArgsSchema.shape as Record<string, z.ZodTypeAny>;
  const result = shapes[type].safeParse(raw.args ?? {});
  if (!result.success) {
    throw new ActionValidationError(
      type,
      result.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`),
    );
  }
  return { type: type as ActionType, args: result.data } as ParsedAction;
}
