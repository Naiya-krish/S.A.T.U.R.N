/**
 * Background plane behind the globe: the zoomed world map of the reference
 * artwork — a sparse dot matrix that is dark overall (avgG ≈ 38 measured) with
 * scattered bright specks, drifting dashed network traces and small nodes.
 *
 * Continent shapes come from the generated land mask, so the dot field reads as
 * land at low gain. The network lines/nodes are SYNTHETIC decoration, not
 * traffic or sensor data. Purely DECORATIVE — labelled as such in the Layers
 * panel.
 */

import { useMemo } from 'react';
import { isLand } from '../globe/textures';

const NODES: { lon: number; lat: number; label: string }[] = [
  { lon: -74, lat: 40.7, label: 'NYC' },
  { lon: -0.1, lat: 51.5, label: 'LDN' },
  { lon: 13.4, lat: 52.5, label: 'BER' },
  { lon: 37.6, lat: 55.75, label: 'MOW' },
  { lon: 127, lat: 37.5, label: 'SEL' },
  { lon: 139.7, lat: 35.7, label: 'TYO' },
  { lon: 77.2, lat: 28.6, label: 'DEL' },
  { lon: 103.8, lat: 1.35, label: 'SIN' },
  { lon: 151.2, lat: -33.9, label: 'SYD' },
  { lon: -46.6, lat: -23.5, label: 'SAO' },
  { lon: 28.0, lat: -26.2, label: 'JNB' },
  { lon: -118.2, lat: 34.0, label: 'LAX' },
];

const LINKS: [string, string][] = [
  ['NYC', 'LDN'], ['LDN', 'BER'], ['LDN', 'MOW'], ['MOW', 'DEL'], ['DEL', 'SIN'],
  ['SIN', 'TYO'], ['SEL', 'TYO'], ['SIN', 'SYD'], ['NYC', 'LAX'], ['LAX', 'TYO'],
  ['SAO', 'JNB'], ['SAO', 'LDN'], ['JNB', 'SIN'], ['DEL', 'MOW'], ['BER', 'DEL'],
];

const W = 940;
const H = 470;

const px = (lon: number) => ((lon + 180) / 360) * W;
const py = (lat: number) => ((90 - lat) / 180) * H;

/** Deterministic PRNG so the plane is identical across reloads/screenshots. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function MapBackdrop() {
  const { dots, links, specks, blocks, gridLines, columns } = useMemo(() => {
    const rnd = seeded(424242);
    const d: { x: number; y: number; o: number; r: number }[] = [];
    // Zoomed dot matrix: ~2.6° pitch — dense enough to read as a tiled world
    // map, but low gain so the plane stays dark (measured avgG ≈ 38).
    for (let lat = -74; lat <= 82; lat += 2.6) {
      const step = 2.6 / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      for (let lon = -180; lon < 180; lon += step) {
        if (!isLand(lon, lat)) continue;
        d.push({ x: px(lon), y: py(lat), o: 0.34 + rnd() * 0.26, r: 0.75 + rnd() * 0.4 });
      }
    }
    const byLabel = new Map(NODES.map((n) => [n.label, n]));
    const l = LINKS.map(([a, b]) => {
      const na = byLabel.get(a)!;
      const nb = byLabel.get(b)!;
      return { x1: px(na.lon), y1: py(na.lat), x2: px(nb.lon), y2: py(nb.lat) };
    });
    // Sparse bright specks scattered across the whole plane.
    const sp: { x: number; y: number; o: number; r: number }[] = [];
    for (let i = 0; i < 380; i++) {
      sp.push({ x: rnd() * W, y: rnd() * H, o: 0.32 + rnd() * 0.55, r: 0.5 + rnd() * 1.2 });
    }
    // Square TILE BLOCKS: the artwork's plane is a tiled readout, with visible
    // square clusters that are densest near the corners of the frame.
    const bl: { x: number; y: number; s: number; o: number; pts: { x: number; y: number }[] }[] = [];
    for (let i = 0; i < 46; i++) {
      const bx = rnd() * W;
      const by = rnd() * H;
      const size = 14 + rnd() * 30;
      const corner = Math.min(1, Math.hypot(bx - W / 2, by - H / 2) / (Math.hypot(W / 2, H / 2)));
      const pts: { x: number; y: number }[] = [];
      const n = 4 + Math.floor(rnd() * 9);
      for (let k = 0; k < n; k++) pts.push({ x: bx + rnd() * size, y: by + rnd() * size });
      bl.push({ x: bx, y: by, s: size, o: 0.10 + corner * 0.34, pts });
    }
    // Ruled grid: a sparse set of full-length lines across the plane.
    const gl: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let x = 0; x <= W; x += W / 12) gl.push({ x1: x, y1: 0, x2: x, y2: H });
    for (let y = 0; y <= H; y += H / 7) gl.push({ x1: 0, y1: y, x2: W, y2: y });
    // Dotted vertical columns (the artwork has dotted strips between grid lines).
    const cols: { pts: { x: number; y: number; o: number }[] }[] = [];
    for (let c = 0; c < 16; c++) {
      const cx0 = rnd() * W;
      const pts: { x: number; y: number; o: number }[] = [];
      for (let y = 0; y < H; y += 5 + rnd() * 5) pts.push({ x: cx0, y, o: 0.20 + rnd() * 0.45 });
      cols.push({ pts });
    }
    return { dots: d, links: l, specks: sp, blocks: bl, gridLines: gl, columns: cols };
  }, []);

  return (
    <svg
      className="map-backdrop"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      width="100%"
      height="100%"
      aria-hidden
    >
      <defs>
        <radialGradient id="nodeGlow">
          <stop offset="0%" stopColor="#d8ffe8" stopOpacity="0.9" />
          <stop offset="40%" stopColor="#39ff88" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#39ff88" stopOpacity="0" />
        </radialGradient>
      </defs>
      {blocks.map((b, i) => (
        <g key={`b${i}`} opacity={b.o}>
          <rect x={b.x} y={b.y} width={b.s} height={b.s} fill="none" stroke="#2fff8f" strokeWidth={0.35} />
          {b.pts.map((p, k) => (
            <circle key={k} cx={p.x} cy={p.y} r={0.7} fill="#8dffbe" />
          ))}
        </g>
      ))}
      {/* faint background GRID — the artwork's plane is ruled, not blank */}
      {gridLines.map((g, i) => (
        <line key={`g${i}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} stroke="#1f8a4c" strokeWidth={0.3} opacity={0.5} />
      ))}
      {/* dotted columns down the plane */}
      {columns.map((c, i) => (
        <g key={`c${i}`}>
          {c.pts.map((p, k) => (
            <circle key={k} cx={p.x} cy={p.y} r={0.55} fill="#39ff88" opacity={p.o} />
          ))}
        </g>
      ))}
      {dots.map((p, i) => (
        <circle key={`d${i}`} cx={p.x} cy={p.y} r={p.r} fill="#4fffa0" opacity={p.o} />
      ))}
      {specks.map((p, i) => (
        <circle key={`s${i}`} cx={p.x} cy={p.y} r={p.r} fill="#b6ffd4" opacity={p.o} />
      ))}
      {links.map((l, i) => {
        const mx = (l.x1 + l.x2) / 2;
        const my = (l.y1 + l.y2) / 2 - Math.abs(l.x2 - l.x1) * 0.16;
        return (
          <path
            key={i}
            d={`M${l.x1},${l.y1} Q${mx},${my} ${l.x2},${l.y2}`}
            stroke="#2fff8f"
            strokeWidth={0.45}
            fill="none"
            opacity={0.22}
            strokeDasharray="1.5 4"
          />
        );
      })}
      {NODES.map((n) => (
        <g key={n.label}>
          <circle cx={px(n.lon)} cy={py(n.lat)} r={7} fill="url(#nodeGlow)" opacity={0.32} />
          <circle cx={px(n.lon)} cy={py(n.lat)} r={1.2} fill="#e2fff0" opacity={0.85} />
        </g>
      ))}
    </svg>
  );
}
