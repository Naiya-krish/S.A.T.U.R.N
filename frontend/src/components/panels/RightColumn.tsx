import { useSaturnStore } from '../../state/useSaturnStore';
import { uiActions } from '../../uiActions/executor';
import { IconChevron, IconGlobe, IconLayers, IconSatellite, IconSettings, IconTarget, IconWave } from '../icons';
import { formatLat, formatLon } from '../../geo/coords';
import styles from '../../styles/console.module.css';

/* ── TARGET PARAMS ─────────────────────────────────────────────── */
export function TargetParamsPanel() {
  const loc = useSaturnStore((s) => s.highlightedLocation);
  const camera = useSaturnStore((s) => s.camera);
  const boundary = useSaturnStore((s) => s.boundary);
  const tilePlan = useSaturnStore((s) => s.tilePlan);

  const bbox = loc?.bbox;
  const latSpan = bbox ? Math.abs(bbox[2] - bbox[0]) : null;
  const lonSpan = bbox ? Math.abs(bbox[3] - bbox[1]) : null;
  const rows: { label: string; value: string; pct: number }[] = [
    { label: 'LATITUDE', value: loc ? formatLat(loc.lat) : formatLat(camera.lat), pct: ((loc?.lat ?? camera.lat) + 90) / 180 },
    { label: 'LONGITUDE', value: loc ? formatLon(loc.lon) : formatLon(camera.lon), pct: ((loc?.lon ?? camera.lon) + 180) / 360 },
    { label: 'LAT SPAN', value: latSpan === null ? '--' : `${latSpan.toFixed(2)}°`, pct: latSpan === null ? 0 : Math.min(1, latSpan / 90) },
    { label: 'LON SPAN', value: lonSpan === null ? '--' : `${lonSpan.toFixed(2)}°`, pct: lonSpan === null ? 0 : Math.min(1, lonSpan / 360) },
    {
      label: 'ALTITUDE',
      value: `${camera.altitudeKm.toLocaleString('en-US')} KM`,
      pct: Math.min(1, camera.altitudeKm / 34000),
    },
  ];

  return (
    <section className="panel" aria-label="Target parameters">
      <header className="panel__head">
        <span>Target Params</span>
        <span className="mono" style={{ fontSize: 6.5, color: boundary ? 'var(--green)' : 'var(--green-text-dim)' }}>
          {boundary ? (boundary.is_exact ? 'OUTLINE' : 'BBOX') : 'NO TARGET'}
        </span>
      </header>
      <div className="panel__body" style={{ paddingTop: 3, paddingBottom: 4 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ marginBottom: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="label-xs">{r.label}</span>
              <span className="kv-value" style={{ fontSize: 7.5 }}>
                {r.value}
              </span>
            </div>
            <div style={{ height: 2, background: 'rgba(57,255,136,0.12)', marginTop: 1 }}>
              <div
                style={{
                  width: `${Math.round(r.pct * 100)}%`,
                  height: '100%',
                  background: 'var(--green)',
                  boxShadow: '0 0 4px rgba(57,255,136,0.6)',
                }}
              />
            </div>
          </div>
        ))}
        <div className="row" style={{ marginTop: 3 }}>
          <span className="kv-label">Observation date</span>
          <span className="kv-value" style={{ fontSize: 7.5 }}>
            {tilePlan?.date ?? '--'}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ── REGION CARDS ──────────────────────────────────────────────── */
const CARD_ICONS = [IconGlobe, IconTarget, IconTarget, IconTarget];

export function RegionCards() {
  const regions = useSaturnStore((s) => s.regions);
  const selected = useSaturnStore((s) => s.selectedRegionIndex);

  return (
    <div className={styles.regionList}>
      {regions.slice(0, 4).map((r, i) => {
        const Icon = CARD_ICONS[i] ?? IconTarget;
        return (
          <div
            key={r.id + i}
            className={styles.regionCard}
            data-selected={i === selected}
            data-empty={r.status === 'EMPTY'}
            onClick={() => void uiActions.human('select_region_card', { index: i })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && void uiActions.human('select_region_card', { index: i })}
            aria-label={`Region ${i + 1}: ${r.name}`}
          >
            <div className={styles.regionHead}>
              <span>{r.name}</span>
              <Icon className={styles.regionIcon} />
            </div>
            <div className={styles.regionRows}>
              <div className={styles.regionRow}>
                <span>TARGET NODE</span>
                <b>{r.targetNode}</b>
              </div>
              <div className={styles.regionRow}>
                <span>LAT / LON</span>
                <b>
                  {r.lat !== undefined && r.lon !== undefined
                    ? `${r.lat.toFixed(2)} / ${r.lon.toFixed(2)}`
                    : '-- / --'}
                </b>
              </div>
              <div className={styles.regionRow}>
                <span>STATUS</span>
                <b>{r.status}</b>
              </div>
            </div>
            <div className={styles.regionInputs}>
              <input value={r.mode} readOnly aria-label="Region mode" />
              <select value={r.status} disabled aria-label="Region availability">
                <option>{r.status}</option>
              </select>
              <i aria-hidden>
                <IconChevron />
              </i>
            </div>
          </div>
        );
      })}
      <button
        className="hud-btn"
        style={{ width: '100%', height: 22, fontSize: 6.5, letterSpacing: '0.25em' }}
        onClick={() => void uiActions.human('save_region', {})}
      >
        SAVE CURRENT REGION
      </button>
    </div>
  );
}

/* ── AGENT TASKS ───────────────────────────────────────────────── */
export function AgentTaskList() {
  const agent = useSaturnStore((s) => s.agent);
  const activeTasks = useSaturnStore((s) => s.activeTasks);
  const playback = useSaturnStore((s) => s.playback);
  const tilesLoaded = useSaturnStore((s) => s.tilesLoaded);
  const tilesTotal = useSaturnStore((s) => s.tilesTotal);
  const tileStatus = useSaturnStore((s) => s.tileStatus);

  const executed = agent.trace.filter((t) => t.status === 'executed').length;
  const failed = agent.trace.filter((t) => t.status === 'failed').length;
  const taskPct =
    agent.stage === 'idle' ? 0 : agent.stage === 'thinking' ? 25 : agent.stage === 'acting' ? 65 : 100;
  const tilePct = tilesTotal ? Math.round((tilesLoaded / tilesTotal) * 100) : tileStatus === 'ready' ? 100 : 0;

  const rows = [
    { icon: IconSatellite, label: 'IMAGERY TILES', value: tilesTotal ? `${tilesLoaded}/${tilesTotal}` : tileStatus.toUpperCase(), pct: tilePct },
    { icon: IconLayers, label: 'UI ACTIONS', value: `${executed}/${executed + failed}`, pct: agent.trace.length ? (executed / agent.trace.length) * 100 : 0 },
    { icon: IconWave, label: 'TIMELINE', value: playback.playing ? 'PLAY' : 'IDLE', pct: playback.playing ? 70 : 0 },
    { icon: IconSettings, label: 'AGENT TASK', value: agent.stage.toUpperCase(), pct: taskPct },
  ];

  return (
    <section className={`panel ${styles.agentTasks}`} aria-label="Running tasks">
      <header className="panel__head">
        <span>Task Queue</span>
        <span className="mono" style={{ fontSize: 6.5, color: 'var(--green)' }}>
          {activeTasks} ACTIVE
        </span>
      </header>
      <div className="panel__body" style={{ paddingTop: 2, paddingBottom: 3 }}>
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <div className={styles.taskRow} key={r.label}>
              <Icon style={{ width: 9, height: 9, color: 'var(--green)' }} />
              <span>{r.label}</span>
              <b>{r.value}</b>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${Math.round(r.pct)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function RightColumn() {
  return (
    <div className={styles.rightCol}>
      <TargetParamsPanel />
      <RegionCards />
      <AgentTaskList />
    </div>
  );
}
