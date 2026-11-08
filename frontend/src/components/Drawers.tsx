import { useEffect, useState } from 'react';
import { api, type AgentConfigResponse } from '../api/client';
import { GIBS_ACK, PRODUCT } from '../config';
import { useSaturnStore } from '../state/useSaturnStore';
import { uiActions } from '../uiActions/executor';
import type { EarthEvent, PanelId } from '../state/types';
import { FreshnessBadge } from './common/FreshnessBadge';
import { IconClose } from './icons';
import styles from '../styles/console.module.css';

const TITLES: Record<PanelId, string> = {
  layers: 'LAYER MANAGER',
  events: 'EVENT & FIRE EVIDENCE',
  sources: 'DATA SOURCE / PROVENANCE',
  history: 'SAVED INVESTIGATIONS',
  settings: 'SYSTEM CONFIGURATION',
  chat: 'AGENT TRANSCRIPT',
};

export function Drawer({ id }: { id: PanelId }) {
  const open = useSaturnStore((s) => s.openPanels[id]);
  if (!open) return null;
  return (
    <aside className={styles.drawer} role="dialog" aria-label={TITLES[id]}>
      <div className={styles.drawerHead}>
        <span>{TITLES[id]}</span>
        <button className="hud-btn" onClick={() => void uiActions.human('close_panel', { panel_id: id })} aria-label="Close panel">
          <IconClose />
        </button>
      </div>
      {id === 'layers' && <LayersPanel />}
      {id === 'events' && <EventsPanel />}
      {id === 'sources' && <SourcesPanel />}
      {id === 'history' && <HistoryPanel />}
      {id === 'settings' && <SettingsPanel />}
      {id === 'chat' && <ChatPanel />}
    </aside>
  );
}

function LayersPanel() {
  const layers = useSaturnStore((s) => s.layers);
  const error = useSaturnStore((s) => s.layersError);
  const active = useSaturnStore((s) => s.activeLayerId);
  const overlays = useSaturnStore((s) => s.overlays);
  const plan = useSaturnStore((s) => s.tilePlan);
  const status = useSaturnStore((s) => s.status);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    void import('../uiActions/executor').then((m) => m.ensureLayerCatalog()).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className={styles.drawerRow}>
        <span>VERIFIED GIBS LAYERS</span>
        <b>{loading ? 'LOADING…' : `${layers.length}`}</b>
      </div>
      {error && <div className={styles.chatLine} data-kind="error">{`Layer catalog unavailable: ${error}`}</div>}
      {layers.map((l) => (
        <div className={styles.drawerRow} key={l.id}>
          <span style={{ maxWidth: 210, lineHeight: 1.35 }}>
            {l.title}
            <br />
            <span className="mono" style={{ fontSize: 6, color: 'var(--green-text-dim)' }}>
              {l.id}
            </span>
          </span>
          <button
            className="hud-btn"
            style={{ width: 'auto', padding: '0 6px', fontSize: 6.5, letterSpacing: '0.18em' }}
            data-active={active === l.id}
            onClick={() => void uiActions.human('set_imagery_layer', { layer_id: l.id })}
          >
            {active === l.id ? 'ACTIVE' : 'LOAD'}
          </button>
        </div>
      ))}
      <div className={styles.sectionHead} style={{ marginTop: 10 }}>
        Overlays
      </div>
      {Object.entries(overlays).map(([k, v]) => (
        <label className={styles.drawerRow} key={k} style={{ cursor: 'pointer' }}>
          <span>{k.toUpperCase()}</span>
          <b style={{ color: v ? 'var(--green)' : 'var(--green-text-dim)' }}>{v ? 'ON' : 'OFF'}</b>
          <input type="checkbox" checked={v} onChange={() => void uiActions.human('toggle_map_overlay', { overlay: k as never })} style={{ display: 'none' }} />
        </label>
      ))}
      <div style={{ marginTop: 10 }}>
        <div className={styles.drawerRow}>
          <span>IMAGERY FRESHNESS</span>
          <FreshnessBadge freshness={plan?.provenance.freshness ?? status.freshness} />
        </div>
        <div className={styles.drawerRow}>
          <span>PRODUCT</span>
          <b>{plan?.title ?? '--'}</b>
        </div>
        <div className={styles.drawerRow}>
          <span>OBSERVATION</span>
          <b>{plan?.provenance.observation_time ?? '--'}</b>
        </div>
        <div className={styles.drawerRow}>
          <span>RETRIEVED</span>
          <b>{plan ? new Date(plan.provenance.retrieval_time).toLocaleTimeString() : '--'}</b>
        </div>
      </div>
      <div className="label-xs" style={{ marginTop: 8, lineHeight: 1.6, letterSpacing: '0.1em' }}>
        DECORATIVE (NOT DATA): dotted world backdrop, node network lines, HUD rings, star field, sweep animation.
        <br />
        BASE TEXTURE IS SYNTHETIC — NOT SATELLITE OBSERVATION.
      </div>
      <div className="badge badge--recent" style={{ marginTop: 6, display: 'inline-block', lineHeight: 1.4, padding: '2px 5px' }}>
        {GIBS_ACK}
      </div>
    </div>
  );
}

function EventsPanel() {
  const events = useSaturnStore((s) => s.events);
  const fires = useSaturnStore((s) => s.fires);
  const firesProv = useSaturnStore((s) => s.firesProvenance);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await api.events(30);
      useSaturnStore.setState({ events: res.events.filter((e): e is EarthEvent => !!e) });
      useSaturnStore.getState().pushLog({ label: 'EONET', kind: 'alert', value: `${res.count} OPEN EVENTS` });
      if (res.events.length) await uiActions.debug('toggle_map_overlay', { overlay: 'events' });
    } catch (e) {
      setMsg(`NASA EONET unavailable: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const loadFires = async () => {
    setLoading(true);
    setMsg(null);
    const b = uiActions.currentBbox();
    try {
      const res = await api.fires(b, 2);
      useSaturnStore.setState({ fires: res.detections, firesProvenance: res.provenance });
      await uiActions.debug('toggle_map_overlay', { overlay: 'fires' });
      setMsg(
        res.count
          ? `${res.count} thermal anomaly detections (not confirmed wildfires).`
          : res.warnings[0] ?? 'No detections in window.',
      );
    } catch (e) {
      setMsg(`NASA FIRMS unavailable: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <button className={styles.cmdBtn} onClick={() => void load()} disabled={loading}>
          LOAD EONET
        </button>
        <button className={styles.cmdBtn} onClick={() => void loadFires()} disabled={loading}>
          LOAD FIRMS
        </button>
      </div>
      {msg && <div className={styles.chatLine}>{msg}</div>}
      {firesProv && (
        <div className={styles.drawerRow}>
          <span>FIRMS FRESHNESS</span>
          <FreshnessBadge freshness={firesProv.freshness} />
        </div>
      )}
      <div className={styles.drawerRow}>
        <span>FIRE DETECTIONS</span>
        <b>{fires.length} · THERMAL ANOMALIES</b>
      </div>
      <div className={styles.sectionHead} style={{ marginTop: 8 }}>
        Open events ({events.length})
      </div>
      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
        {events.length === 0 && <div className={styles.chatLine}>No events loaded. Press LOAD EONET.</div>}
        {events.slice(0, 25).map((e) => (
          <button
            key={e.id}
            className={styles.candidate}
            onClick={() => void uiActions.human('focus_event', { event_id: e.id, lat: e.lat ?? undefined, lon: e.lon ?? undefined })}
          >
            <b>{e.category.toUpperCase()}</b> · {e.title}
            <br />
            <span className="mono" style={{ fontSize: 6 }}>
              {e.time ? new Date(e.time).toISOString().slice(0, 10) : '--'} · NASA EONET · {e.status.toUpperCase()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SourcesPanel() {
  const plan = useSaturnStore((s) => s.tilePlan);
  const layersError = useSaturnStore((s) => s.layersError);
  const status = useSaturnStore((s) => s.status);
  const loc = useSaturnStore((s) => s.highlightedLocation);

  return (
    <div>
      <div className={styles.sectionHead}>Imagery</div>
      <div className={styles.drawerRow}>
        <span>PROVIDER</span>
        <b>{plan?.provider ?? 'NASA GIBS (no layer loaded)'}</b>
      </div>
      <div className={styles.drawerRow}>
        <span>PRODUCT</span>
        <b>{plan?.title ?? '--'}</b>
      </div>
      <div className={styles.drawerRow}>
        <span>FRESHNESS</span>
        <FreshnessBadge freshness={plan?.provenance.freshness ?? 'UNAVAILABLE'} />
      </div>
      <div className={styles.drawerRow}>
        <span>ATTRIBUTION</span>
        <b style={{ maxWidth: 190, lineHeight: 1.4 }}>{plan?.attribution ?? 'NASA GIBS'}</b>
      </div>
      {layersError && <div className={styles.chatLine} data-kind="error">{layersError}</div>}

      <div className={styles.sectionHead} style={{ marginTop: 10 }}>
        Geocoding
      </div>
      <div className={styles.drawerRow}>
        <span>OPENSTREETMAP NOMINATIM</span>
        <b>{loc ? 'LAST RESULT' : 'READY'}</b>
      </div>
      <div className={styles.drawerRow}>
        <span>©</span>
        <b>OpenStreetMap contributors · ODbL</b>
      </div>

      <div className={styles.sectionHead} style={{ marginTop: 10 }}>
        Agent
      </div>
      <div className={styles.drawerRow}>
        <span>MODE</span>
        <b>{status.agentMode.toUpperCase()}</b>
      </div>
      <div className={styles.drawerRow}>
        <span>FIRMS</span>
        <b>{status.firms ? 'CONFIGURED' : 'KEY MISSING'}</b>
      </div>
      <div className={styles.chatLine} style={{ marginTop: 8 }}>
        Data never leaves the server except through the typed tool responses. Imagery is fetched directly from NASA GIBS
        tile servers in the browser; no API keys are exposed.
      </div>
    </div>
  );
}

function HistoryPanel() {
  const messages = useSaturnStore((s) => s.messages);
  return (
    <div>
      <div className={styles.chatLine}>
        Saved investigations require Firebase (Phase 8 — not configured). Session transcript is kept in memory only and is
        cleared on reload.
      </div>
      <div className={styles.sectionHead} style={{ marginTop: 8 }}>
        Session ({messages.length})
      </div>
      {messages.length === 0 && <div className={styles.chatLine}>No commands yet this session.</div>}
      {messages.slice(-14).map((m) => (
        <div className={styles.chatLine} key={m.id} data-role={m.role} data-kind={m.kind}>
          <em>{m.role}</em>
          {m.text}
        </div>
      ))}
    </div>
  );
}

function SettingsPanel() {
  const status = useSaturnStore((s) => s.status);
  const [cfg, setCfg] = useState<AgentConfigResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const checkboxes = useSaturnStore((s) => s.checkboxes);

  useEffect(() => {
    api
      .agentConfig()
      .then(setCfg)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div>
      <div className={styles.drawerRow}>
        <span>BACKEND</span>
        <b>{status.backend} · {status.latencyMs ?? '--'}ms</b>
      </div>
      <div className={styles.drawerRow}>
        <span>NETWORK</span>
        <b>{status.network}</b>
      </div>
      <div className={styles.drawerRow}>
        <span>AGENT MODE</span>
        <b>{cfg?.mode ?? status.agentMode}</b>
      </div>
      <div className={styles.drawerRow}>
        <span>MODEL</span>
        <b>{cfg?.model ?? 'unknown'}</b>
      </div>
      {cfg && (
        <div className={styles.drawerRow}>
          <span>LIMITS</span>
          <b>
            {cfg.limits.max_tool_calls} calls / {cfg.limits.tool_timeout_s}s / {cfg.limits.overall_timeout_s}s
          </b>
        </div>
      )}
      <div className={styles.drawerRow}>
        <span>FIRMS KEY</span>
        <b>{cfg?.firms_configured ? 'CONFIGURED' : 'MISSING'}</b>
      </div>
      <div className={styles.drawerRow}>
        <span>AUTO-SYNC</span>
        <b>{checkboxes.auto_refresh ? 'ON' : 'OFF'}</b>
      </div>
      <div className={styles.drawerRow}>
        <span>TELEMETRY</span>
        <b>{checkboxes.telemetry ? 'ON' : 'OFF'}</b>
      </div>
      {err && <div className={styles.chatLine} data-kind="error">{`Config unavailable: ${err}`}</div>}
      <div className={styles.sectionHead} style={{ marginTop: 10 }}>
        Keys
      </div>
      <div className="label-xs" style={{ lineHeight: 1.7, letterSpacing: '0.1em' }}>
        [1] focus · ENTER run · ESC stop listening
        <br />
        [2] VERTEX AI: set GOOGLE_CLOUD_PROJECT + ADC on the server
        <br />
        [3] FIRMS: set FIRMS_MAP_KEY on the server only
      </div>
    </div>
  );
}

function ChatPanel() {
  const messages = useSaturnStore((s) => s.messages);
  const trace = useSaturnStore((s) => s.agent.trace);
  const stage = useSaturnStore((s) => s.agent.stage);
  return (
    <div>
      <div className={styles.drawerRow}>
        <span>{PRODUCT.name} AGENT</span>
        <b>{stage.toUpperCase()}</b>
      </div>
      {messages.length === 0 && <div className={styles.chatLine}>Speak or type a command. Try “Show South Korea with the latest satellite imagery”.</div>}
      {messages.map((m) => (
        <div className={styles.chatLine} key={m.id} data-role={m.role} data-kind={m.kind}>
          <em>{m.role}</em>
          {m.text}
        </div>
      ))}
      {trace.length > 0 && (
        <div className={styles.ackList}>
          {trace.slice(-8).map((t, i) => (
            <div key={`${t.action_id}-${i}`}>
              {t.type} · <span data-status={t.status}>{t.status.toUpperCase()}</span>
              {t.error ? ` · ${t.error}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
