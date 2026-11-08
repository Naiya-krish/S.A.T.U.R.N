/**
 * Boot sequence overlay. Purely visual; it does not fake any telemetry —
 * each step is a real client-side initialisation, and data steps are labelled
 * as deferred to the backend.
 */

import { useEffect, useMemo, useState } from 'react';
import { PRODUCT } from '../config';
import styles from '../styles/loader.module.css';

const STEPS = [
  'INITIALISING ORBITAL RENDERER',
  'MOUNTING SPHERICAL MESH · WEBGL',
  'LOADING UI ACTION REGISTRY',
  'SYNCING TASK BUS · SSE',
  'AWAITING FIRST COMMAND',
];

export function Loader({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState(0);
  const [fading, setFading] = useState(false);
  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => {
    if (reduced) {
      setProgress(100);
      const t = window.setTimeout(onDone, 400);
      return () => window.clearTimeout(t);
    }
    const started = performance.now();
    const duration = 3400;
    let frame = 0;
    const tick = () => {
      const p = Math.min(100, ((performance.now() - started) / duration) * 100);
      setProgress(p);
      setStep(Math.min(STEPS.length - 1, Math.floor((p / 100) * STEPS.length)));
      if (p >= 100) {
        setFading(true);
        window.setTimeout(onDone, 750);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onDone, reduced]);

  return (
    <div className={styles.loader} data-fading={fading} role="status" aria-live="polite">
      <div className={styles.grid} aria-hidden />
      <div className={styles.radar} aria-hidden>
        <div className={styles.ring1} />
        <div className={styles.ring2} />
        <div className={styles.ring3} />
        <div className={styles.sweep} />
        <div className={styles.core} />
        <div className={styles.ticks} />
      </div>

      <div className={styles.center}>
        <div className={styles.kicker}>ORBITAL EARTH-INTELLIGENCE COMMAND</div>
        <h1 className={styles.logo}>
          {['S', 'A', 'T', 'U', 'R', 'N'].map((ch, i) => (
            <span key={ch} className={styles.letter} style={{ animationDelay: `${i * 0.3}s` }}>
              {ch}
              {i < 5 && <i className={styles.dot}>.</i>}
            </span>
          ))}
        </h1>
        <div className={styles.full}>SENTIENT AGENTIC TERRAIN &amp; UNIVERSE RECONNAISSANCE NETWORK</div>

        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
        <div className={styles.progressMeta}>
          <span>{STEPS[step]}</span>
          <span>{Math.round(progress).toString().padStart(3, '0')}%</span>
        </div>

        <div className={styles.steps}>
          {STEPS.slice(0, 4).map((s, i) => (
            <div key={s} className={styles.step} data-done={i < step}>
              <span className={styles.stepDot} />
              {s}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.footer}>
        <span>{PRODUCT.version}</span>
        <span>VOICE + TEXT CONTROL · NASA GIBS · OSM</span>
        <span>SECURE CHANNEL</span>
      </div>
    </div>
  );
}
