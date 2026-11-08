import { useState } from 'react';
import { resolveAndHighlight, uiActions } from '../uiActions/executor';
import { useSaturnStore } from '../state/useSaturnStore';
import { IconGlobe, IconSearch, IconTarget } from './icons';
import styles from '../styles/console.module.css';

export function SearchBox() {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string>('WORLDWIDE · NAME OR LAT, LON');
  const candidates = useSaturnStore((s) => s.candidates);
  const status = useSaturnStore((s) => s.resolveStatus);

  const run = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    const res = await resolveAndHighlight(value);
    setHint(res.ok ? `LOCKED · ${res.message.toUpperCase()}` : res.message.toUpperCase());
    setBusy(false);
  };

  const pick = async (index: number) => {
    const c = useSaturnStore.getState().candidates[index];
    if (!c) return;
    setBusy(true);
    await uiActions.execute({
      action_id: `pick-${Date.now()}`,
      origin: 'human',
      type: 'highlight_location',
      args: { name: c.name, lat: c.lat, lon: c.lon, bbox: c.bbox },
    });
    await uiActions.human('navigate_globe', { lat: c.lat, lon: c.lon });
    setHint(`LOCKED · ${c.name.toUpperCase()}`);
    useSaturnStore.setState({ candidates: [] });
    setBusy(false);
  };

  return (
    <div className={styles.searchWrap}>
      <div className={styles.searchRow}>
        <IconSearch />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
          placeholder={busy ? 'RESOLVING…' : 'SEARCH LOCATION / LAT, LON'}
          aria-label="Search location"
          spellCheck={false}
        />
        <button className="hud-btn" onClick={() => void run()} aria-label="Resolve location" disabled={busy}>
          <IconTarget />
        </button>
        <button
          className="hud-btn"
          onClick={() => void uiActions.human('restore_global_view', {})}
          aria-label="Global view"
          title="Global view"
        >
          <IconGlobe />
        </button>
      </div>
      <div className={styles.searchHint}>
        {status === 'ambiguous' ? 'AMBIGUOUS — PICK A CANDIDATE' : hint}
      </div>
      {candidates.length > 1 && (
        <div className={styles.candidateList}>
          {candidates.map((c, i) => (
            <button key={c.id} className={styles.candidate} onClick={() => void pick(i)}>
              <b>{c.name}</b> · {c.type}
              {c.country ? ` · ${c.country}` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
