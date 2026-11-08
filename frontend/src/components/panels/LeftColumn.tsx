import { useEffect, useMemo, useState } from 'react';
import { useSaturnStore } from '../../state/useSaturnStore';
import { IconFolder, IconLayers, IconPin, IconSatellite, IconSearch, IconCpu } from '../icons';
import { MiniLineChart, Sparkline } from '../../utils/charts';
import { FreshnessBadge } from '../common/FreshnessBadge';
import styles from '../../styles/console.module.css';

/* ── SYSTEM STATUS ─────────────────────────────────────────────── */
export function SystemStatusPanel() {
  const status = useSaturnStore((s) => s.status);
  const activeTasks = useSaturnStore((s) => s.activeTasks);
  const [samples, setSamples] = useState<number[]>(() => Array.from({ length: 24 }, (_, i) => 50 + Math.sin(i / 2) * 12 + 20));

  useEffect(() => {
    const id = window.setInterval(() => {
      const base = status.latencyMs ?? 120;
      setSamples((prev) => [...prev.slice(-23), Math.max(8, base + (Math.random() - 0.5) * 30)]);
    }, 2000);
    return () => window.clearInterval(id);
  }, [status.latencyMs]);

  const backendLabel = status.backend === 'ONLINE' ? 'ONLINE' : status.backend === 'CHECKING' ? 'LINKING' : 'OFFLINE';
  const vertexLabel = status.vertex === 'READY' ? 'VERTEX' : status.vertex === 'MOCK' ? 'MOCK' : 'N/A';

  return (
    <section className="panel" aria-label="System status">
      <header className="panel__head">
        <span>System Status</span>
        <span className="mono" style={{ fontSize: 7, color: 'var(--green)' }}>
          {String(status.latencyMs ?? '--').padStart(3, '0')}MS
        </span>
      </header>
      <div className="panel__body" style={{ paddingTop: 2, paddingBottom: 3 }}>
        <div className="row">
          <span className="kv-label">
            <span className={`dot ${status.backend === 'ONLINE' ? '' : 'dot--warn'}`} />
            Backend
          </span>
          <span className="kv-value">{backendLabel}</span>
        </div>
        <div className="row">
          <span className="kv-label">
            <span className={`dot ${status.vertex === 'READY' ? '' : 'dot--off'}`} />
            Vertex AI
          </span>
          <span className="kv-value">{vertexLabel}</span>
        </div>
        <div className="row">
          <span className="kv-label">
            <span className={`dot ${status.network === 'ONLINE' ? '' : 'dot--off'}`} />
            Network
          </span>
          <span className="kv-value">{status.network}</span>
        </div>
        <div className="row">
          <span className="kv-label">Active tasks</span>
          <span className="kv-value">{String(activeTasks).padStart(2, '0')}</span>
        </div>
        <div className="row">
          <span className="kv-label">Data freshness</span>
          <FreshnessBadge freshness={status.freshness} />
        </div>
        <Sparkline data={samples} height={16} />
      </div>
    </section>
  );
}

/* ── TIME LOG ──────────────────────────────────────────────────── */
const KIND_LABEL: Record<string, string> = {
  camera: 'NAV',
  layer: 'IMG',
  agent: 'AGT',
  alert: 'ALT',
  system: 'SYS',
};

export function TimeLogPanel() {
  const logs = useSaturnStore((s) => s.logs);
  const messages = useSaturnStore((s) => s.messages);
  const camera = useSaturnStore((s) => s.camera);
  const playback = useSaturnStore((s) => s.playback);

  const series = useMemo(() => {
    const base = camera.altitudeKm;
    return Array.from({ length: 28 }, (_, i) => Math.sin(i / 3.2) * 0.5 + Math.cos(i / 7) * 0.3 + base / 34000);
  }, [camera.altitudeKm]);

  const rows = useMemo(() => {
    const fromMessages = messages.slice(-3).map((m) => ({
      label: m.role === 'operator' ? 'CMD' : 'RESP',
      value: m.text.split(' ').slice(0, 3).join(' ').toUpperCase(),
    }));
    const fromLogs = logs
      .slice(-4)
      .reverse()
      .map((l) => ({ label: KIND_LABEL[l.kind] ?? 'EVT', value: l.value.slice(0, 22).toUpperCase() }));
    return [...fromMessages, ...fromLogs].slice(0, 4);
  }, [logs, messages]);

  return (
    <section className="panel" aria-label="Time log">
      <header className="panel__head">
        <span>Time Log</span>
        <div className={styles.iconBtns}>
          <button className="hud-btn" title="Pin task" aria-label="Pin task" disabled>
            <IconPin />
          </button>
          <button className="hud-btn" title="Search log" aria-label="Search log" disabled>
            <IconSearch />
          </button>
          <button className="hud-btn" title="Saved investigations" aria-label="Saved investigations" disabled>
            <IconFolder />
          </button>
        </div>
      </header>
      <div className="panel__body" style={{ paddingTop: 3, paddingBottom: 4 }}>
        <MiniLineChart data={series} height={34} />
        <div className={styles.logList}>
          {rows.length === 0 && (
            <div className={styles.logRow}>
              <span>No events yet</span>
              <strong>--:--</strong>
            </div>
          )}
          {rows.map((r, i) => (
            <div className={styles.logRow} key={`${r.label}-${i}`}>
              <span>{r.label}</span>
              <strong>{r.value || '--'}</strong>
            </div>
          ))}
        </div>
        <div className={styles.segBar} aria-hidden>
          {Array.from({ length: 22 }).map((_, i) => (
            <span key={i} data-on={i < (playback.playing ? 22 : logs.length + messages.length + 4)} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── SENSOR READOUT ────────────────────────────────────────────── */
export function SensorReadoutPanel() {
  const activeLayerTitle = useSaturnStore((s) => s.activeLayerTitle);
  const observationDate = useSaturnStore((s) => s.observationDate);
  const tilesLoaded = useSaturnStore((s) => s.tilesLoaded);
  const tilesTotal = useSaturnStore((s) => s.tilesTotal);
  const events = useSaturnStore((s) => s.events);
  const fires = useSaturnStore((s) => s.fires);
  const tileStatus = useSaturnStore((s) => s.tileStatus);

  const coverage = tilesTotal > 0 ? Math.round((tilesLoaded / tilesTotal) * 100) : null;
  const layerShort = activeLayerTitle ? activeLayerTitle.split('(')[0].trim().slice(0, 22) : 'BASE TEXTURE';
  const bars = useMemo(() => {
    return Array.from({ length: 18 }, (_, i) => {
      const seeded = Math.abs(Math.sin(i * 3.7)) * 0.6 + 0.15;
      return Math.round(seeded * 100);
    });
  }, []);

  return (
    <section className="panel" aria-label="Sensor readout">
      <header className="panel__head">
        <span>Sensor Readout</span>
        <span className="mono" style={{ fontSize: 6.5, letterSpacing: '0.16em', color: 'var(--green-text)' }}>
          {tileStatus === 'ready' ? 'GIBS' : 'NO IMAGERY'}
        </span>
      </header>
      <div className="panel__body" style={{ paddingTop: 2, paddingBottom: 3 }}>
        <div className="row">
          <span className="kv-label">
            <IconSatellite style={{ width: 8, height: 8, marginRight: 3, verticalAlign: '-1px' }} />
            Active layer
          </span>
          <span className="kv-value" title={activeLayerTitle ?? 'Base texture (not satellite)'}>
            {layerShort}
          </span>
        </div>
        <div className="row">
          <span className="kv-label">Observation</span>
          <span className="kv-value">{observationDate ?? '--'}</span>
        </div>
        <div className="row">
          <span className="kv-label">Tile coverage</span>
          <span className="kv-value">{coverage === null ? '--' : `${coverage}%`}</span>
        </div>
        <div className="row">
          <span className="kv-label">Events / fires</span>
          <span className="kv-value">
            {String(events.length).padStart(2, '0')} / {String(fires.length).padStart(3, '0')}
          </span>
        </div>
        <div className="row">
          <span className="kv-label">
            <IconCpu style={{ width: 8, height: 8, marginRight: 3, verticalAlign: '-1px' }} />
            Camera mode
          </span>
          <span className="kv-value">{activeLayerTitle ? 'IMAGERY' : 'WIRE'}</span>
        </div>
        <div className={styles.barStrip} aria-hidden>
          {bars.map((b, i) => (
            <span key={i} style={{ height: `${Math.max(8, b)}%` }} />
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
          <IconLayers style={{ width: 8, height: 8, color: 'var(--green-text-dim)' }} />
          <span style={{ fontSize: 6, letterSpacing: '0.16em', color: 'var(--green-text-dim)' }}>
            {activeLayerTitle ? 'NASA GIBS DAILY COMPOSITE' : 'BASE TEXTURE — NOT SATELLITE OBSERVATION'}
          </span>
        </div>
      </div>
    </section>
  );
}

export function LeftColumn() {
  return (
    <div className={styles.leftCol}>
      <SystemStatusPanel />
      <TimeLogPanel />
      <SensorReadoutPanel />
    </div>
  );
}
