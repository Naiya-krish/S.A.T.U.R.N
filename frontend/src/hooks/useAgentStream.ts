/**
 * Agent bridge: submits commands, consumes the SSE task stream, executes the
 * UI actions in the browser and acknowledges each one (only then does the
 * backend let the model say the action happened).
 */

import { useCallback, useEffect, useRef } from 'react';
import { api, API_BASE_TASKS } from '../api/client';
import { globe } from '../globe/GlobeController';
import { useSaturnStore } from '../state/useSaturnStore';
import type { TaskActionTrace } from '../state/types';
import { uiActions } from '../uiActions/executor';
import { speak } from './useVoice';

function base(): string {
  return API_BASE_TASKS;
}

export function useAgentStream() {
  const esRef = useRef<EventSource | null>(null);
  const taskRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const stop = useCallback(async () => {
    cancelledRef.current = true;
    const id = taskRef.current;
    taskRef.current = null;
    closeStream();
    useSaturnStore.setState((s) => ({ agent: { ...s.agent, stage: 'idle' } }));
    if (id) {
      try {
        await api.cancelTask(id);
      } catch {
        /* already finished */
      }
    }
    useSaturnStore.getState().addMessage({ role: 'system', kind: 'info', text: 'Task cancelled by operator.' });
  }, [closeStream]);

  const connect = useCallback(
    (taskId: string) => {
      closeStream();
      taskRef.current = taskId;
      cancelledRef.current = false;
      const es = new EventSource(`${base()}/${taskId}/events`);
      esRef.current = es;

      const setStage = (stage: 'idle' | 'thinking' | 'acting' | 'speaking') =>
        useSaturnStore.setState((s) => ({ agent: { ...s.agent, stage } }));

      es.onmessage = async (ev) => {
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(ev.data);
        } catch {
          return;
        }
        const kind = payload.kind as string;
        const data = (payload.data ?? {}) as Record<string, unknown>;

        if (kind === 'status') {
          const status = data.status as string;
          if (status === 'running') setStage('thinking');
          if (status === 'completed') {
            setStage('speaking');
            useSaturnStore.getState().setActiveTasks(0);
            window.setTimeout(() => setStage('idle'), 1400);
            closeStream();
          }
          if (status === 'failed' || status === 'cancelled') {
            setStage('idle');
            useSaturnStore.getState().setActiveTasks(0);
            closeStream();
          }
          return;
        }

        if (kind === 'tool') {
          const phase = data.phase as string;
          if (phase === 'call') {
            setStage('acting');
            useSaturnStore.setState((s) => ({ agent: { ...s.agent, lastTool: String(data.name) } }));
          }
          if (phase === 'result') {
            useSaturnStore.getState().pushLog({ label: 'TOOL', kind: 'agent', value: `${String(data.name)} ${String(data.summary ?? '').slice(0, 26)}` });
          }
          return;
        }

        if (kind === 'ui_action') {
          const action = data.action as { action_id?: string; type?: string; args?: Record<string, unknown> } | undefined;
          const ack = data.ack as { status?: string } | undefined;
          if (action && !ack) {
            if (cancelledRef.current) {
              await reportAck(taskId, action.action_id ?? '', 'cancelled', undefined, 'Cancelled by operator.');
              return;
            }
            const res = await uiActions.execute({
              action_id: action.action_id,
              type: action.type,
              args: action.args,
              origin: 'agent',
            });
            const trace: TaskActionTrace = {
              action_id: action.action_id ?? '',
              type: String(action.type),
              status: res.status,
              error: res.error ?? null,
            };
            useSaturnStore.setState((s) => ({
              agent: { ...s.agent, trace: [...s.agent.trace.slice(-24), trace] },
            }));
            await reportAck(taskId, action.action_id ?? '', res.status, res.result, res.error);
          }
          return;
        }

        if (kind === 'message') {
          const text = String(data.text ?? '');
          if (text) {
            useSaturnStore.getState().addMessage({ role: 'assistant', text, kind: 'info' });
            if (!data.partial) speak(text);
          }
          return;
        }

        if (kind === 'result') {
          const text = String(data.text ?? '');
          useSaturnStore.setState((s) => ({ agent: { ...s.agent, error: null } }));
          const store = useSaturnStore.getState();
          const last = store.messages[store.messages.length - 1];
          if (text && last?.text !== text) store.addMessage({ role: 'assistant', text, kind: 'result' });
          if (text) speak(text);
          store.pushLog({ label: 'RESP', kind: 'agent', value: text.slice(0, 30) });
          return;
        }

        if (kind === 'error') {
          const message = String(data.message ?? 'Agent error.');
          useSaturnStore.setState((s) => ({ agent: { ...s.agent, error: message } }));
          useSaturnStore.getState().addMessage({ role: 'system', kind: 'error', text: message });
        }
      };

      es.addEventListener('end', () => closeStream());
      es.onerror = () => {
        // EventSource retries automatically; close once the task is done.
        const stage = useSaturnStore.getState().agent.stage;
        if (stage === 'idle') closeStream();
      };
    },
    [closeStream],
  );

  const submit = useCallback(
    async (text: string, mode: 'text' | 'voice' = 'text') => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const store = useSaturnStore.getState();
      store.addMessage({ role: 'operator', text: trimmed });
      store.pushLog({ label: 'CMD', kind: 'agent', value: trimmed.slice(0, 34).toUpperCase() });
      useSaturnStore.setState((s) => ({
        agent: { ...s.agent, stage: 'thinking', trace: [], error: null },
      }));
      try {
        const res = await api.command(trimmed, mode, buildUiSnapshot());
        taskRef.current = res.task_id;
        useSaturnStore.setState((s) => ({ agent: { ...s.agent, taskId: res.task_id } }));
        store.setActiveTasks(1);
        connect(res.task_id);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        useSaturnStore.setState((s) => ({ agent: { ...s.agent, stage: 'idle', error: message } }));
        useSaturnStore.getState().addMessage({
          role: 'system',
          kind: 'error',
          text: `Agent request failed: ${message}. Is the backend running on :8787?`,
        });
        useSaturnStore.getState().setActiveTasks(0);
      }
    },
    [connect],
  );

  useEffect(
    () => () => {
      closeStream();
    },
    [closeStream],
  );

  const flyTo = useCallback((lat: number, lon: number, altitudeKm?: number) => {
    void uiActions.debug('navigate_globe', { lat, lon, altitude_km: altitudeKm });
  }, []);

  return { submit, stop, flyTo, globeReady: () => globe.ready };
}

/** Compact UI state sent with each command (what the operator currently sees). */
function buildUiSnapshot(): Record<string, unknown> {
  const s = useSaturnStore.getState();
  const snap = globe.snapshot();
  return {
    camera: snap
      ? { lat: snap.lat, lon: snap.lon, altitude_km: snap.altitudeKm }
      : { lat: s.camera.lat, lon: s.camera.lon, altitude_km: s.camera.altitudeKm },
    active_layer: s.activeLayerId,
    observation_date: s.observationDate,
    opacity: s.opacity,
    overlays: s.overlays,
    selected_region: s.regions[s.selectedRegionIndex]?.name ?? null,
    open_panels: Object.entries(s.openPanels)
      .filter(([, v]) => v)
      .map(([k]) => k),
    comparison: s.comparison.mode === 'off' ? null : s.comparison,
    last_location: s.highlightedLocation
      ? {
          id: s.highlightedLocation.id,
          name: s.highlightedLocation.name,
          lat: s.highlightedLocation.lat,
          lon: s.highlightedLocation.lon,
          bbox: s.highlightedLocation.bbox,
        }
      : null,
  };
}

async function reportAck(
  taskId: string,
  actionId: string,
  status: string,
  result?: Record<string, unknown>,
  error?: string,
) {
  if (!actionId) return;
  try {
    await api.ackAction(actionId, { action_id: actionId, status, result, error }, taskId);
  } catch {
    /* backend already closed the task */
  }
}
