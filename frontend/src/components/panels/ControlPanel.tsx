import { useEffect, useMemo, useState } from 'react';
import { useSaturnStore } from '../../state/useSaturnStore';
import { uiActions } from '../../uiActions/executor';
import { MiniLineChart } from '../../utils/charts';
import { IconChevron, IconPause, IconPlay, IconClock } from '../icons';
import styles from '../../styles/console.module.css';

/**
 * Floating control panel: imagery opacity, observation date + playback,
 * second slider (exposure / gain), and the TIMELINE row.
 */
export function FloatingControlPanel() {
  const opacity = useSaturnStore((s) => s.opacity);
  const sliders = useSaturnStore((s) => s.sliders);
  const latestDates = useSaturnStore((s) => s.latestDates);
  const observationDate = useSaturnStore((s) => s.observationDate);
  const playback = useSaturnStore((s) => s.playback);
  const activeLayerId = useSaturnStore((s) => s.activeLayerId);
  const [tick, setTick] = useState(0);

  const series = useMemo(() => Array.from({ length: 40 }, (_, i) => Math.sin(i / 3) * 0.4 + Math.cos(i / 8) * 0.25 + 0.5), [tick]);

  // Playback: steps back through real available dates only.
  useEffect(() => {
    if (!playback.playing || latestDates.length < 2) return;
    const id = window.setInterval(() => {
      const idx = observationDate ? latestDates.indexOf(observationDate) : 0;
      const next = latestDates[(idx + 1) % latestDates.length];
      void uiActions.debug('set_observation_date', { date: next });
      setTick((t) => t + 1);
    }, 1600);
    return () => window.clearInterval(id);
  }, [playback.playing, latestDates, observationDate]);

  const dateIndex = observationDate ? latestDates.indexOf(observationDate) : -1;
  const timelineValue = latestDates.length ? (dateIndex >= 0 ? dateIndex / (latestDates.length - 1 || 1) : 0) : 0;

  return (
    <section className={`${styles.controlPanel} panel`} aria-label="Imagery controls">
      <div className={styles.controlHead}>
        <span>Imagery Control</span>
        <span className="mono" style={{ fontSize: 6.5, color: 'var(--green-text)' }}>
          {activeLayerId ? 'GIBS' : 'STANDBY'}
        </span>
      </div>
      <MiniLineChart data={series} height={30} />

      <div>
        <div className={styles.controlLine}>
          <span className="kv-label">Opacity</span>
          <span className={styles.controlValue}>{Math.round(opacity * 100)}%</span>
        </div>
        <div className="slider">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(opacity * 100)}
            style={{ ['--fill' as string]: `${opacity * 100}%` }}
            aria-label="Layer opacity"
            onChange={(e) => void uiActions.human('set_layer_opacity', { value: Number(e.target.value) / 100 })}
          />
        </div>
      </div>

      <div className={styles.timelineRow}>
        <span className={styles.timelineIcon}>
          <IconClock style={{ width: 11, height: 11 }} />
        </span>
        <span className={styles.timelineLabel}>Timeline</span>
        <button
          className="hud-btn"
          aria-label={playback.playing ? 'Pause playback' : 'Start playback'}
          onClick={() => void uiActions.human('start_timeline_playback', { playing: !playback.playing })}
          data-active={playback.playing}
        >
          {playback.playing ? <IconPause /> : <IconPlay />}
        </button>
        <IconChevron style={{ width: 9, height: 9, color: 'var(--green-text-dim)' }} />
      </div>

      <div>
        <div className={styles.controlLine}>
          <span className="kv-label">Date</span>
          <span className={styles.controlValue}>{observationDate ?? 'LATEST'}</span>
        </div>
        <div className="slider">
          <input
            type="range"
            min={0}
            max={Math.max(1, latestDates.length - 1)}
            value={dateIndex < 0 ? 0 : dateIndex}
            disabled={latestDates.length < 2}
            style={{ ['--fill' as string]: `${timelineValue * 100}%` }}
            aria-label="Observation date"
            onChange={(e) => {
              const d = latestDates[Number(e.target.value)];
              if (d) void uiActions.human('set_observation_date', { date: d });
            }}
          />
        </div>
        <div className={styles.controlLine} style={{ marginTop: 2 }}>
          <span className="kv-label" style={{ fontSize: 6 }}>
            Day {latestDates.length ? `${dateIndex < 0 ? 1 : dateIndex + 1}/${latestDates.length}` : '--'}
          </span>
          <span className={styles.controlValue} style={{ fontSize: 6.5 }}>
            {latestDates.length ? latestDates[latestDates.length - 1] : '--'}
          </span>
        </div>
      </div>

      <div>
        <div className={styles.controlLine}>
          <span className="kv-label">HUD Gain</span>
          <span className={styles.controlValue}>{Math.round(sliders.gain * 100)}%</span>
        </div>
        <div className="slider">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(sliders.gain * 100)}
            style={{ ['--fill' as string]: `${sliders.gain * 100}%` }}
            aria-label="HUD gain"
            onChange={(e) => void uiActions.human('set_slider', { control_id: 'gain', value: Number(e.target.value) / 100 })}
          />
        </div>
      </div>
    </section>
  );
}
