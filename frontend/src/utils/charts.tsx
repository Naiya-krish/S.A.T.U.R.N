/** Tiny SVG chart primitives (no chart library) used by the HUD panels. */

import { useMemo } from 'react';

function path(points: number[], width: number, height: number, pad = 1): string {
  if (points.length < 2) return '';
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  return points
    .map((p, i) => {
      const x = pad + (i / (points.length - 1)) * (width - pad * 2);
      const y = height - pad - ((p - min) / span) * (height - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function Sparkline({
  data,
  width = 180,
  height = 18,
  stroke = '#39ff88',
  fill = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: boolean;
}) {
  const d = useMemo(() => path(data, width, height), [data, width, height]);
  const area = d ? `${d} L${width - 1},${height} L1,${height} Z` : '';
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden>
      {fill && area && <path d={area} fill="url(#sparkFill)" opacity={0.28} />}
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.7" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {d && <path d={d} stroke={stroke} strokeWidth={1} fill="none" />}
      {d && (
        <circle
          cx={width - 1}
          cy={height - 1 - (((data[data.length - 1] - Math.min(...data)) / (Math.max(...data) - Math.min(...data) || 1)) * (height - 2))}
          r={1.6}
          fill={stroke}
        />
      )}
    </svg>
  );
}

export function MiniLineChart({
  data,
  width = 200,
  height = 40,
  color = '#39ff88',
  baseline = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  baseline?: boolean;
}) {
  const d = useMemo(() => path(data, width, height, 2), [data, width, height]);
  const last = data[data.length - 1] ?? 0;
  const min = Math.min(...data, 0);
  const max = Math.max(...data, 1);
  const y = height - 2 - ((last - min) / (max - min || 1)) * (height - 4);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden>
      {baseline &&
        [0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={width} y1={height * f} y2={height * f} stroke="rgba(57,255,136,0.08)" strokeWidth={0.5} />
        ))}
      {d && <path d={d} stroke={color} strokeWidth={1.1} fill="none" />}
      <circle cx={width - 2} cy={y} r={2} fill={color} opacity={0.9} />
    </svg>
  );
}

/** Deterministic waveform strip above the readout boxes. */
export function WaveStrip({
  seed = 7,
  width = 852,
  height = 30,
  color = '#39ff88',
  live = 0,
}: {
  seed?: number;
  width?: number;
  height?: number;
  color?: string;
  live?: number;
}) {
  const pts = useMemo(() => {
    const out: number[] = [];
    let v = 0.5;
    for (let i = 0; i < 240; i++) {
      const r = Math.sin(i * 12.9898 + seed) * 43758.5453;
      const n = r - Math.floor(r);
      v = v * 0.72 + n * 0.28;
      const envelope = Math.sin((i / 240) * Math.PI) ** 0.6;
      out.push(0.12 + envelope * (0.35 + v * 0.6) * (live > 0 ? 1 : 0.55));
    }
    return out;
  }, [seed, live]);

  const mid = height / 2;
  const upper = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (pts.length - 1)) * width).toFixed(1)},${(mid - p * (height / 2 - 1)).toFixed(1)}`).join(' ');
  const lower = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(((pts.length - 1 - i) / (pts.length - 1)) * width).toFixed(1)},${(mid + p * (height / 2 - 1)).toFixed(1)}`)
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      <line x1={0} x2={width} y1={mid} y2={mid} stroke="rgba(57,255,136,0.12)" strokeWidth={0.6} />
      <path d={upper} stroke={color} strokeWidth={0.7} fill="none" opacity={0.75} />
      <path d={`${upper} L${width},${mid} L0,${mid} Z`} fill={color} opacity={0.06} />
      <path d={lower} stroke={color} strokeWidth={0.7} fill="none" opacity={0.35} />
      {Array.from({ length: 60 }).map((_, i) => (
        <line
          key={i}
          x1={(i / 59) * width}
          x2={(i / 59) * width}
          y1={mid - (i % 5 === 0 ? 3 : 1.5)}
          y2={mid + (i % 5 === 0 ? 3 : 1.5)}
          stroke="rgba(57,255,136,0.14)"
          strokeWidth={0.5}
        />
      ))}
    </svg>
  );
}
