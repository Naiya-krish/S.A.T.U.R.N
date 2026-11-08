import { useEffect, useRef, useState } from 'react';
import { formatLat, formatLon } from '../geo/coords';
import { globe } from '../globe/GlobeController';
import { useSaturnStore } from '../state/useSaturnStore';
import { WaveStrip } from '../utils/charts';
import { CommandBar } from './CommandBar';
import styles from '../styles/console.module.css';

function Box({
  label,
  value,
  sub,
  unavailable,
}: {
  label: string;
  value: string;
  sub: string;
  unavailable?: boolean;
}) {
  return (
    <div className={`${styles.readoutBox} panel`}>
      <span className={styles.readoutLabel}>{label}</span>
      <span className={styles.readoutValue} data-unavailable={unavailable}>
        {value}
      </span>
      <span className={styles.readoutSub}>
        <span>{sub}</span>
        {unavailable ? <span className="badge badge--unavail">N/A</span> : <span />}
      </span>
    </div>
  );
}

export function ReadoutStrip() {
  const camera = useSaturnStore((s) => s.camera);
  const highlighted = useSaturnStore((s) => s.highlightedLocation);
  const [speed, setSpeed] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    let last = globe.speedKmS();
    const tick = () => {
      const s = globe.speedKmS();
      if (Math.abs(s - last) > 0.5) {
        last = s;
        setSpeed(s);
      } else if (s < 0.5 && last >= 0.5) {
        last = 0;
        setSpeed(0);
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const lat = highlighted?.lat ?? camera.lat;
  const lon = highlighted?.lon ?? camera.lon;

  return (
    <div className={styles.readoutWrap}>
      <div className={styles.waveStrip} aria-hidden>
        <WaveStrip seed={11} live={speed} />
      </div>
      <div className={styles.readoutRow}>
        <Box label="LAT" value={formatLat(lat)} sub={highlighted ? 'TARGET' : 'CAMERA'} />
        <Box label="LON" value={formatLon(lon)} sub={highlighted ? 'TARGET' : 'CAMERA'} />
        <Box
          label="VEL"
          value={speed > 0 ? `${speed.toFixed(1)} KM/S` : '0.0 KM/S'}
          sub={speed > 0 ? 'CAM GROUND TRACK' : 'STATIONARY'}
        />
        <Box label="TEMP" value="--" sub="NO SENSOR" unavailable />
        <Box label="ALT" value={`${camera.altitudeKm.toLocaleString('en-US')} KM`} sub="CAMERA ORBIT" />
      </div>
      <CommandBar />
    </div>
  );
}
