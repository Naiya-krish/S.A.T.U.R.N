import { describe, expect, it } from 'vitest';
import { ACTION_TYPES, ActionValidationError, parseAction, UIActionEnvelope } from './schema';

const REQUIRED_ACTIONS = [
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
  'clear_all',
  'inspect_globe_state',
];

describe('UI action schema', () => {
  it('covers every reference control', () => {
    REQUIRED_ACTIONS.forEach((a) => expect(ACTION_TYPES).toContain(a));
  });

  it('accepts valid actions', () => {
    expect(parseAction({ type: 'navigate_globe', args: { lat: 37.5, lon: 127 } })).toEqual({
      type: 'navigate_globe',
      args: { lat: 37.5, lon: 127 },
    });
    expect(parseAction({ type: 'set_layer_opacity', args: { value: 0.5 } })).toBeTruthy();
    expect(parseAction({ type: 'clear_all', args: {} })).toBeTruthy();
  });

  it('rejects latitude out of range', () => {
    expect(() => parseAction({ type: 'navigate_globe', args: { lat: 95, lon: 0 } })).toThrow(ActionValidationError);
  });

  it('rejects missing arguments', () => {
    expect(() => parseAction({ type: 'set_imagery_layer', args: {} })).toThrow(ActionValidationError);
  });

  it('rejects bad enum values', () => {
    expect(() => parseAction({ type: 'toggle_map_overlay', args: { overlay: 'rainbows' } })).toThrow(ActionValidationError);
  });

  it('rejects malformed dates', () => {
    expect(() => parseAction({ type: 'set_observation_date', args: { date: 'yesterday' } })).toThrow(ActionValidationError);
    expect(parseAction({ type: 'set_observation_date', args: { date: '2026-10-28' } })).toBeTruthy();
  });

  it('rejects unknown action types', () => {
    expect(() => parseAction({ type: 'self_destruct', args: {} })).toThrow(ActionValidationError);
  });

  it('validates the SSE envelope', () => {
    const env = UIActionEnvelope.parse({ action_id: 'abc', type: 'clear_all', args: {} });
    expect(env.status).toBe('accepted');
    expect(env.origin).toBe('agent');
  });
});
