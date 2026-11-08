import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from './api/client';
import { CommandBar } from './components/CommandBar';
import { Drawer } from './components/Drawers';
import { GlobeView } from './components/GlobeView';
import { Loader } from './components/Loader';
import { MapBackdrop } from './components/MapBackdrop';
import { ReadoutStrip } from './components/ReadoutStrip';
import { SearchBox } from './components/SearchBox';
import { TitleFrame } from './components/TitleFrame';
import { FloatingControlPanel } from './components/panels/ControlPanel';
import { FarRightColumn } from './components/panels/FarRightColumn';
import { ClockPanel } from './components/panels/ClockPanel';
import { LeftColumn } from './components/panels/LeftColumn';
import { RightColumn } from './components/panels/RightColumn';
import { BOOTED_KEY, DESIGN, ENABLE_LOADER } from './config';
import { globe } from './globe/GlobeController';
import { useAgentStream } from './hooks/useAgentStream';
import { OfflineBanner, useServiceWorker } from './hooks/usePwa';
import { useSaturnStore } from './state/useSaturnStore';
import { ensureLayerCatalog, loadDatesFor } from './uiActions/executor';
import consoleStyles from './styles/console.module.css';

function hasBootedBefore(): boolean {
  try {
    return sessionStorage.getItem(BOOTED_KEY) === '1';
  } catch {
    return false;
  }
}

function useStageScale() {
  const [scale, setScale] = useState(1);
  const [mobile, setMobile] = useState(false);
  useLayoutEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setMobile(w < 900);
      setScale(Math.min(w / DESIGN.width, h / DESIGN.height));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);
  return { scale, mobile };
}

/** Polls backend health + agent config and mirrors it into the store. */
function useServicePulse() {
  const setStatus = useSaturnStore((s) => s.setStatus);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const { data, latencyMs, ok } = await api.health();
      if (!alive) return;
      setStatus({
        backend: ok ? 'ONLINE' : 'OFFLINE',
        latencyMs,
        network: navigator.onLine ? 'ONLINE' : 'OFFLINE',
      });
      if (ok && data) {
        setStatus({ vertex: data.agent_mode === 'vertex' ? 'READY' : 'MOCK', agentMode: data.agent_mode });
        if (data.agent_mode === 'mock' && !useSaturnStore.getState().agent.modeNoted) {
          useSaturnStore.getState().addMessage({
            role: 'system',
            kind: 'info',
            text: 'Agent running in DETERMINISTIC MOCK mode (no Vertex AI project configured). Tools still call real NASA/OSM services.',
          });
          useSaturnStore.setState((s) => ({ agent: { ...s.agent, modeNoted: true } }));
        }
      }
      try {
        const cfg = await api.agentConfig();
        if (alive) setStatus({ firms: cfg.firms_configured, agentMode: cfg.mode });
      } catch {
        /* agent config unavailable (older backend) */
      }
    };
    void poll();
    const id = window.setInterval(poll, 15000);
    const online = () => setStatus({ network: 'ONLINE' });
    const offline = () => setStatus({ network: 'OFFLINE' });
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [setStatus]);
}

/** Applies store changes to the Three.js scene (single direction of flow). */
function useSceneSync() {
  const overlays = useSaturnStore((s) => s.overlays);
  const landmarks = useSaturnStore((s) => s.landmarks);
  const events = useSaturnStore((s) => s.events);
  const fires = useSaturnStore((s) => s.fires);

  useEffect(() => {
    (Object.keys(overlays) as (keyof typeof overlays)[]).forEach((k) => globe.setOverlay(k, overlays[k]));
  }, [overlays]);

  useEffect(() => {
    globe.setLandmarks(landmarks);
  }, [landmarks]);

  useEffect(() => {
    globe.setEvents(
      events
        .filter((e) => e.lat !== null && e.lat !== undefined && e.lon !== null && e.lon !== undefined)
        .map((e) => ({ id: e.id, lat: e.lat as number, lon: e.lon as number, category: e.category, title: e.title })),
    );
  }, [events]);

  useEffect(() => {
    globe.setFires(fires.map((f) => ({ id: f.id, lat: f.lat, lon: f.lon, confidence: f.confidence ?? null })));
  }, [fires]);
}

function AgentIndicator() {
  const stage = useSaturnStore((s) => s.agent.stage);
  const { stop } = useAgentStream();
  if (stage === 'idle') return null;
  return (
    <div className={consoleStyles.agentIndicator}>
      <span>{stage === 'acting' ? 'AGENT CONTROLLING UI' : stage === 'speaking' ? 'AGENT RESPONDING' : 'AGENT THINKING'}</span>
      <button className="hud-btn" style={{ width: 'auto', padding: '0 5px', fontSize: 6.5 }} onClick={() => void stop()}>
        STOP
      </button>
    </div>
  );
}

function DebugBridge() {
  useEffect(() => {
    void import('./uiActions/executor').then(({ uiActions }) => {
      (window as unknown as { saturn: unknown }).saturn = { uiActions, globe, store: useSaturnStore };
    });
  }, []);
  return null;
}

function DesktopConsole() {
  return (
    <>
      <div className={consoleStyles.backdrop} aria-hidden />
      <div className={consoleStyles.mapBackdrop} aria-hidden>
        <MapBackdrop />
      </div>
      <GlobeView />
      <div className={consoleStyles.globeRingTick} aria-hidden />
      <div className={consoleStyles.globeSweep} aria-hidden />

      <ClockPanel />
      <SearchBox />
      <TitleFrame />
      <LeftColumn />
      <FloatingControlPanel />
      <RightColumn />
      <FarRightColumn />
      <ReadoutStrip />
      <AgentIndicator />
      {(['layers', 'events', 'sources', 'history', 'settings', 'chat'] as const).map((id) => (
        <Drawer key={id} id={id} />
      ))}
    </>
  );
}

function MobileConsole({ drawer }: { drawer: 'info' | 'control' | null }) {
  const [active, setActive] = useState<'info' | 'control' | null>(drawer);
  const toggle = (d: 'info' | 'control') => setActive((cur) => (cur === d ? null : d));
  return (
    <div className={consoleStyles.mobile}>
      <div className={consoleStyles.mobileGlobe}>
        <GlobeView />
      </div>
      <div className={consoleStyles.mobileTop}>
        <span className={consoleStyles.mobileTitle}>S.A.T.U.R.N.</span>
        <div style={{ display: 'flex', gap: 6, pointerEvents: 'auto' }}>
          <button className="hud-btn" onClick={() => toggle('info')} aria-label="Panels">
            SYST
          </button>
          <button className="hud-btn" onClick={() => toggle('control')} aria-label="Controls">
            CTRL
          </button>
        </div>
      </div>
      <div className={consoleStyles.mobileDrawer} data-open={active === 'info'} aria-hidden={active !== 'info'}>
        <div className={consoleStyles.mobileDrawerHandle} onClick={() => setActive(null)}>
          PANELS ▾
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <SearchBox />
          <LeftColumn />
          <RightColumn />
        </div>
      </div>
      <div className={consoleStyles.mobileDrawer} data-open={active === 'control'} aria-hidden={active !== 'control'}>
        <div className={consoleStyles.mobileDrawerHandle} onClick={() => setActive(null)}>
          CONTROLS ▾
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          <FloatingControlPanel />
          <FarRightColumn />
        </div>
      </div>
      <div className={consoleStyles.mobileBottom}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--green-text)', marginBottom: 5 }}>
          <MobileReadout />
        </div>
        <CommandBar compact />
        <AgentIndicator />
      </div>
    </div>
  );
}

function MobileReadout() {
  const camera = useSaturnStore((s) => s.camera);
  return (
    <>
      <span>LAT {camera.lat.toFixed(3)}</span>
      <span>LON {camera.lon.toFixed(3)}</span>
      <span>ALT {camera.altitudeKm} KM</span>
      <span>VEL --</span>
      <span>TEMP --</span>
    </>
  );
}

export default function App() {
  const { scale, mobile } = useStageScale();
  const booted = useSaturnStore((s) => s.booted);
  const setBooted = useSaturnStore((s) => s.setBooted);
  const pushedScale = useRef(0);
  const skipIntro = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('noboot') === '1';
  const { stop: stopAgent } = useAgentStream();

  useServicePulse();
  useSceneSync();
  useServiceWorker();

  // Test/tooling hook: ?noboot=1 skips the intro overlay.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('noboot') === '1') setBooted(true);
  }, [setBooted]);

  useEffect(() => {
    void ensureLayerCatalog().then(async () => {
      const s = useSaturnStore.getState();
      const preferred =
        s.layers.find((l) => l.id === 'MODIS_Terra_CorrectedReflectance_TrueColor') ?? s.layers[0];
      if (preferred) {
        useSaturnStore.setState((st) => ({ dropdowns: { ...st.dropdowns, layer: preferred.id } }));
        await loadDatesFor(preferred.id);
      }
    });
  }, []);

  useEffect(() => {
    if (Math.abs(pushedScale.current - scale) > 0.0001) {
      pushedScale.current = scale;
      document.documentElement.style.setProperty('--scale', String(scale));
    }
  }, [scale]);



  useEffect(() => {
    const id = window.setInterval(async () => {
      const st = useSaturnStore.getState();
      const tid = st.agent.taskId;
      if (!tid || st.agent.stage === 'idle') return;
      try {
        const data = await api.task(tid);
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
          const stage = useSaturnStore.getState().agent.stage;
          if (stage !== 'idle') void stopAgent();
        }
      } catch {
        /* backend unreachable */
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [stopAgent]);

  const finishBoot = useCallback(() => {
    try {
      sessionStorage.setItem(BOOTED_KEY, '1');
    } catch {
      /* private mode */
    }
    setBooted(true);
  }, [setBooted]);

  return (
    <>
      <DebugBridge />
      {ENABLE_LOADER && !booted && !skipIntro && <Loader onDone={finishBoot} />}
      <div className={consoleStyles.viewport} data-booting={!booted && ENABLE_LOADER && hasBootedBefore()}>
        <OfflineBanner />
        <div className={consoleStyles.vignette} aria-hidden />
        <div className={consoleStyles.noise} aria-hidden />
        {mobile ? (
          <MobileConsole drawer={null} />
        ) : (
          <div className={consoleStyles.stage} style={{ transform: `scale(${scale})` }}>
            <DesktopConsole />
          </div>
        )}
      </div>
    </>
  );
}
