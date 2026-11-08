import { useEffect, useRef } from 'react';
import { globe } from '../globe/GlobeController';
import { GlobeScene } from '../globe/GlobeScene';
import { useSaturnStore } from '../state/useSaturnStore';
import styles from '../styles/console.module.css';

/**
 * Mounts the Three.js GlobeScene and keeps it in sync with the store.
 * Camera readouts flow back to the store at animation-frame rate.
 */
export function GlobeView({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new GlobeScene(host);
    globe.attach(scene);
    let lastPush = 0;
    scene.setCallbacks({
      onCamera: (lat, lon, altitudeKm) => {
        const now = performance.now();
        if (now - lastPush < 120) return;
        lastPush = now;
        useSaturnStore.getState().setCamera({
          lat: Number(lat.toFixed(4)),
          lon: Number(lon.toFixed(4)),
          altitudeKm: Math.round(altitudeKm),
        });
      },
      onTileStatus: (loaded, requested, failed) => {
        useSaturnStore.setState((s) => ({
          tilesLoaded: loaded,
          tilesTotal: requested,
          tileStatus: failed > 0 && loaded === 0 ? 'error' : s.tileStatus,
        }));
      },
    });
    const s = useSaturnStore.getState();
    (Object.keys(s.overlays) as (keyof typeof s.overlays)[]).forEach((k) => scene.setOverlay(k, s.overlays[k]));
    scene.setOpacity(s.opacity);
    return () => {
      globe.attach(null);
      scene.dispose();
      // React (dev StrictMode) may re-run effects; drop the unused host node
      host.replaceChildren();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={[className, styles.globeHost].filter(Boolean).join(' ')}
      role="img"
      aria-label="Interactive 3D globe. Drag to rotate, scroll to zoom."
    />
  );
}
