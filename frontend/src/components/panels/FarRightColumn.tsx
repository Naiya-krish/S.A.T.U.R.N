import { useEffect } from 'react';
import { useSaturnStore } from '../../state/useSaturnStore';
import { uiActions } from '../../uiActions/executor';
import {
  IconFire,
  IconGrid,
  IconLayers,
  IconSettings,
  IconStar4,
  IconVoice,
  IconWeather,
} from '../icons';
import styles from '../../styles/console.module.css';
import { AuthChip } from './AuthChip';

const OVERLAY_CHECKS = [
  { id: 'boundaries', label: 'BOUNDS' },
  { id: 'fires', label: 'FIRES' },
  { id: 'events', label: 'EVENTS' },
  { id: 'labels', label: 'LABELS' },
  { id: 'grid', label: 'GRID' },
  { id: 'network', label: 'NODES' },
] as const;

export function FarRightColumn() {
  const dropdowns = useSaturnStore((s) => s.dropdowns);
  const sliders = useSaturnStore((s) => s.sliders);
  const checkboxes = useSaturnStore((s) => s.checkboxes);
  const overlays = useSaturnStore((s) => s.overlays);
  const layers = useSaturnStore((s) => s.layers);
  const query = useSaturnStore((s) => s.query);
  const highlighted = useSaturnStore((s) => s.highlightedLocation);
  const activeLayerTitle = useSaturnStore((s) => s.activeLayerTitle);
  const latestDates = useSaturnStore((s) => s.latestDates);
  const openPanels = useSaturnStore((s) => s.openPanels);

  useEffect(() => {
    if (!layers.length) {
      void import('../../uiActions/executor').then((m) => m.ensureLayerCatalog());
    }
  }, [layers.length]);

  const setDrop = (id: keyof typeof dropdowns, value: string) => void uiActions.human('select_dropdown', { control_id: id, value });

  return (
    <div className={styles.farRight}>
      <div className={styles.iconRow} role="toolbar" aria-label="Quick actions">
        <button className="hud-btn" title="Layers" aria-label="Layers panel" data-active={openPanels.layers} onClick={() => void uiActions.human('open_panel', { panel_id: 'layers' })}>
          <IconLayers />
        </button>
        <button className="hud-btn" title="Fire observations" aria-label="Events panel" data-active={openPanels.events} onClick={() => void uiActions.human('open_panel', { panel_id: 'events' })}>
          <IconFire />
        </button>
        <button className="hud-btn" title="Weather (not connected)" aria-label="Weather — not connected" disabled>
          <IconWeather />
        </button>
        <button className="hud-btn" title="Settings" aria-label="Settings" onClick={() => void uiActions.human('open_panel', { panel_id: 'settings' })}>
          <IconSettings />
        </button>
        <button className="hud-btn" title="Voice" aria-label="Voice command" onClick={() => void uiActions.human('open_panel', { panel_id: 'chat' })}>
          <IconVoice />
        </button>
        <button className="hud-btn" title="Data sources" aria-label="Data sources" onClick={() => void uiActions.human('open_panel', { panel_id: 'sources' })}>
          <IconGrid />
        </button>
      </div>

      <div className={styles.textBlock}>
        ORBITAL EARTH-INTELLIGENCE NETWORK
        <br />
        NOMINAL LINK · UTC SYNC
        <br />
        {layers.length} VERIFIED LAYERS · {latestDates.length} DATES
      </div>

      <div className={styles.statusBox}>
        <div className={styles.statusBoxLabel}>STATUS</div>
        <div className={styles.statusBoxValue} title={highlighted?.name}>
          {highlighted ? `REGION: ${highlighted.name}` : 'REGION: GLOBAL'}
        </div>
        <div className={styles.statusBoxLabel} style={{ marginTop: 2, color: 'rgba(217,166,255,0.7)' }}>
          {highlighted?.country ? highlighted.country.toUpperCase().slice(0, 26) : 'NO TARGET LOCK'}
        </div>
      </div>

      <AuthChip />

      <div className={styles.sectionHead}>Data Source Config</div>

      <div className={styles.sliderStack}>
        {(['exposure', 'gain'] as const).map((id) => (
          <div key={id}>
            <div className={styles.sliderRow}>
              <span className="kv-label">{id === 'exposure' ? 'Exposure' : 'Signal gain'}</span>
              <span className={styles.miniPct}>{Math.round(sliders[id] * 100)}%</span>
            </div>
            <div className="slider">
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(sliders[id] * 100)}
                style={{ ['--fill' as string]: `${sliders[id] * 100}%` }}
                aria-label={id}
                onChange={(e) => void uiActions.human('set_slider', { control_id: id, value: Number(e.target.value) / 100 })}
              />
            </div>
            <div className={styles.sliderRow} style={{ fontSize: 5.5, color: 'var(--green-text-dim)' }}>
              <span>0%</span>
              <span>100%</span>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.operatorField}>
        <span className="kv-label">Operator</span>
        <input value={query ? `TRACE: ${query.slice(0, 18)}` : 'LOCAL OPERATOR'} readOnly aria-label="Operator" />
      </div>

      <div className={styles.operatorField}>
        <span className="kv-label">Layer</span>
        <select value={dropdowns.layer} onChange={(e) => setDrop('layer', e.target.value)} aria-label="Layer">
          <option value="AUTO">AUTO · LATEST TRUE COLOUR</option>
          {layers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.id.replace(/_/g, ' ').slice(0, 34)}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.operatorField}>
        <span className="kv-label">Product</span>
        <select value={dropdowns.product} onChange={(e) => setDrop('product', e.target.value)} aria-label="Product">
          <option value="AUTO">DAILY COMPOSITE</option>
          <option value="TRUE_COLOR">TRUE COLOUR</option>
          <option value="FALSE_COLOR">FALSE COLOUR</option>
        </select>
      </div>
      <div className={styles.operatorField}>
        <span className="kv-label">Projection</span>
        <select value={dropdowns.projection} onChange={(e) => setDrop('projection', e.target.value)} aria-label="Projection">
          <option value="EPSG:3857">EPSG:3857</option>
          <option value="EPSG:4326" disabled>
            EPSG:4326 · NOT SUPPORTED
          </option>
        </select>
      </div>
      <div className={styles.operatorField}>
        <span className="kv-label">Date</span>
        <select value={dropdowns.date} onChange={(e) => setDrop('date', e.target.value)} aria-label="Observation date">
          <option value="LATEST">LATEST AVAILABLE</option>
          {latestDates.slice(0, 12).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.checkGrid}>
        {OVERLAY_CHECKS.map((o) => (
          <label key={o.id} className={styles.checkItem}>
            <span className={styles.checkBox} data-on={overlays[o.id]}>
              {overlays[o.id] ? '×' : ''}
            </span>
            <input
              type="checkbox"
              checked={overlays[o.id]}
              onChange={() => void uiActions.human('toggle_checkbox', { control_id: o.id })}
              style={{ display: 'none' }}
              aria-label={o.label}
            />
            {o.label}
          </label>
        ))}
        <label className={styles.checkItem}>
          <span className={styles.checkBox} data-on={checkboxes.telemetry}>
            {checkboxes.telemetry ? '×' : ''}
          </span>
          <input
            type="checkbox"
            checked={checkboxes.telemetry}
            onChange={() => void uiActions.human('toggle_checkbox', { control_id: 'telemetry' })}
            style={{ display: 'none' }}
            aria-label="Telemetry"
          />
          TELEMETRY
        </label>
        <label className={styles.checkItem}>
          <span className={styles.checkBox} data-on={checkboxes.auto_refresh}>
            {checkboxes.auto_refresh ? '×' : ''}
          </span>
          <input
            type="checkbox"
            checked={checkboxes.auto_refresh}
            onChange={() => void uiActions.human('toggle_checkbox', { control_id: 'auto_refresh' })}
            style={{ display: 'none' }}
            aria-label="Auto refresh"
          />
          AUTO-SYNC
        </label>
      </div>

      <button className={styles.operatorBtn} title={activeLayerTitle ?? 'No imagery loaded'} onClick={() => void uiActions.human('save_region', {})}>
        Operator
      </button>

      <button
        className={styles.sparkle}
        aria-label="Agent chat history"
        title="Agent chat history"
        onClick={() => void uiActions.human('open_panel', { panel_id: 'chat' })}
      >
        <IconStar4 />
      </button>
    </div>
  );
}
