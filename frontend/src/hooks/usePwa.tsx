import { useEffect, useState } from 'react';
import styles from '../styles/console.module.css';

/**
 * Registers the app-shell service worker in production builds only.
 *
 * In dev the service worker is skipped on purpose: it would cache Vite's module
 * graph and serve stale code while editing.
 */
export function useServiceWorker() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (!('serviceWorker' in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => setReady(true))
        .catch(() => setReady(false));
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);
  return ready;
}

/**
 * Offline / connectivity banner.
 *
 * Says exactly what is degraded: the shell is cached, but agent commands,
 * imagery and location search all need the network, so they are unavailable.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  const [backendDown, setBackendDown] = useState(false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        if (alive) setBackendDown(!r.ok);
      } catch {
        if (alive) setBackendDown(true);
      }
    };
    ping();
    const id = window.setInterval(ping, 15000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (online && !backendDown) return null;

  return (
    <div className={styles.offlineBanner} role="status" aria-live="polite">
      <span className={styles.offlineDot} />
      {!online
        ? 'OFFLINE — cached interface only. Agent commands, imagery and search need a connection.'
        : 'BACKEND UNREACHABLE — the interface is up but no data can be fetched.'}
    </div>
  );
}
