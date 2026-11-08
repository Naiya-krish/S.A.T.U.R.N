/** Thin typed API client. All backend calls go through /api (Vite proxy in dev). */

import { API_BASE } from '../config';

export { API_BASE };
import type {
  EarthEvent,
  FireDetection,
  LayerInfo,
  Provenance,
  ResolveResponse,
  TilePlan,
} from '../state/types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail = (body as { detail?: unknown; error?: unknown })?.detail ?? (body as { error?: unknown })?.error;
    const msg =
      typeof detail === 'string' ? detail : typeof body === 'string' ? body : JSON.stringify(detail ?? body);
    throw new ApiError(res.status, msg || `HTTP ${res.status}`);
  }
  return body as T;
}

export interface HealthResponse {
  status: string;
  version: string;
  agent_mode: 'vertex' | 'mock';
  vertex_model: string | null;
  now: string;
}

export interface AgentConfigResponse {
  mode: 'vertex' | 'mock';
  model: string;
  project_configured: boolean;
  location: string;
  limits: { max_tool_calls: number; tool_timeout_s: number; overall_timeout_s: number };
  firms_configured: boolean;
}

export const API_BASE_TASKS = `${API_BASE}/tasks`;

export const api = {
  async health(): Promise<{ data: HealthResponse | null; latencyMs: number; ok: boolean }> {
    const t0 = performance.now();
    try {
      const data = await request<HealthResponse>('/health');
      return { data, latencyMs: Math.round(performance.now() - t0), ok: true };
    } catch {
      return { data: null, latencyMs: Math.round(performance.now() - t0), ok: false };
    }
  },

  agentConfig: () => request<AgentConfigResponse>('/agent/config'),

  resolve: (q: string) =>
    request<ResolveResponse>(`/geo/resolve?q=${encodeURIComponent(q)}`).catch(async (err) => {
      // 404/422 still carry a structured body; re-read it for an honest message.
      if (err instanceof ApiError && err.message.startsWith('{')) {
        return JSON.parse(err.message) as ResolveResponse;
      }
      throw err;
    }),

  layers: () => request<{ layers: LayerInfo[]; provenance: Provenance }>('/imagery/layers'),

  layer: (layerId: string) => request<LayerInfo>(`/imagery/layer/${encodeURIComponent(layerId)}`),

  dates: (layerId: string, days = 21) =>
    request<{ layer_id: string; latest: string; dates: { date: string; available: boolean; reason?: string | null }[] }>(
      `/imagery/dates?layer_id=${encodeURIComponent(layerId)}&days=${days}`,
    ),

  plan: (layerId: string, date: string) =>
    request<TilePlan>('/imagery/plan', { method: 'POST', body: JSON.stringify({ layer_id: layerId, date }) }),

  events: (days = 30) => request<{ count: number; events: EarthEvent[] }>(`/events?days=${days}`),

  fires: (bbox: [number, number, number, number], days = 2) =>
    request<{ detections: FireDetection[]; count: number; provenance: Provenance; warnings: string[] }>('/fires', {
      method: 'POST',
      body: JSON.stringify({ bbox, days }),
    }),

  command: (text: string, mode: 'text' | 'voice' = 'text', uiState: Record<string, unknown> = {}) =>
    request<{ task_id: string; status: string; mode: string }>('/agent/command', {
      method: 'POST',
      body: JSON.stringify({ text, mode, ui_state: uiState }),
    }),

  cancelTask: (taskId: string) => request<{ cancelled: boolean }>(`/tasks/${taskId}/cancel`, { method: 'POST' }),

  task: (taskId: string) =>
    request<{ status: string; actions: { action_id: string; status: string; error?: string | null }[] }>(
      `/tasks/${encodeURIComponent(taskId)}`,
    ),

  ackAction: (
    actionId: string,
    ack: { action_id: string; status: string; result?: unknown; error?: string },
    taskId?: string,
  ) =>
    request<{ ok: boolean }>(
      `/ui-actions/${actionId}/ack${taskId ? `?task_id=${encodeURIComponent(taskId)}` : ''}`,
      { method: 'POST', body: JSON.stringify(ack) },
    ),
};
