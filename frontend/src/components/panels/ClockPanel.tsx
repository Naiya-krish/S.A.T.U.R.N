import { useEffect, useState } from 'react';
import { useSaturnStore } from '../../state/useSaturnStore';
import styles from '../../styles/console.module.css';

function zoneLabel(tz: string, date: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(date);
    const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC';
    return `${off.replace('GMT', 'UTC')} / ${Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(date)} LOCAL`;
  } catch {
    return 'UTC';
  }
}

export function ClockPanel() {
  const timezone = useSaturnStore((s) => s.timezone);
  const setTimezone = useSaturnStore((s) => s.setTimezone);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
    .format(now)
    .toUpperCase();

  const zones = ['UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London'];

  return (
    <section className={`${styles.clockPanel} panel`} aria-label="System clock">
      <div className={styles.clockTime} aria-live="off">
        {time}
      </div>
      <div className={styles.clockMeta}>
        <span>
          <span className={styles.clockDot} />
          {date}
        </span>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          aria-label="Time zone"
          style={{ height: 13, fontSize: 6.5, padding: '0 2px', letterSpacing: '0.1em', maxWidth: 84 }}
        >
          {[timezone, ...zones.filter((z) => z !== timezone)].map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.clockMeta} style={{ color: 'var(--green-text-dim)' }}>
        <span>{zoneLabel(timezone, now)}</span>
        <span>CLK/SYNC</span>
      </div>
    </section>
  );
}
