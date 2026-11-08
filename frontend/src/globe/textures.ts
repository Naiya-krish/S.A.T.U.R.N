/**
 * Procedural textures for the S.A.T.U.R.N. globe.
 *
 * The default sphere is a SYNTHETIC, generated landmass map used purely as a
 * visual base ("BASE TEXTURE — NOT SATELLITE OBSERVATION"). Real imagery only
 * appears when a NASA GIBS layer is loaded and acknowledged on screen.
 */

import * as THREE from 'three';

/**
 * Coarse land polygons ([lon, lat] rings, ~10–20 vertices per continent).
 * Close enough for a recognisable globe silhouette; NOT survey data.
 */
const LAND: [number, number][][] = [
  // North America
  [
    [-168, 65], [-160, 71], [-140, 70], [-125, 70], [-110, 68], [-95, 70], [-85, 70], [-80, 62],
    [-95, 55], [-88, 48], [-75, 45], [-66, 45], [-60, 47], [-64, 44], [-70, 41], [-75, 35],
    [-81, 31], [-80, 25], [-83, 28], [-90, 29], [-97, 26], [-97, 21], [-92, 19], [-87, 21],
    [-87, 16], [-83, 15], [-84, 10], [-79, 9], [-77, 8], [-83, 8], [-87, 13], [-92, 15],
    [-97, 16], [-105, 20], [-110, 24], [-114, 31], [-117, 33], [-122, 37], [-124, 42],
    [-124, 48], [-130, 54], [-140, 60], [-150, 60], [-158, 57], [-165, 60], [-168, 65],
  ],
  // Central America bridge (thin)
  [[-92, 17], [-88, 18], [-83, 15], [-81, 9], [-77, 8], [-78, 9], [-84, 11], [-88, 15], [-92, 17]],
  // Greenland
  [[-73, 78], [-58, 82], [-30, 83], [-20, 76], [-22, 70], [-40, 60], [-48, 61], [-55, 67], [-62, 76], [-73, 78]],
  // South America
  [
    [-81, 8], [-76, 11], [-71, 12], [-62, 11], [-52, 6], [-50, 0], [-44, -2], [-35, -5],
    [-39, -14], [-41, -22], [-48, -25], [-53, -34], [-58, -38], [-62, -40], [-65, -45],
    [-68, -50], [-70, -55], [-74, -52], [-75, -46], [-73, -37], [-71, -30], [-70, -20],
    [-76, -14], [-81, -6], [-80, -2], [-79, 2], [-77, 7], [-81, 8],
  ],
  // Iceland
  [[-24, 65], [-15, 66], [-13, 64], [-19, 63], [-24, 65]],
  // British Isles
  [[-6, 58], [-2, 58], [0, 53], [-2, 51], [-5, 50], [-5, 53], [-6, 58]],
  [[-10, 54], [-6, 55], [-6, 52], [-10, 51], [-10, 54]],
  // Europe + Asia (single landmass)
  [
    [-10, 36], [-9, 43], [-2, 43], [-2, 48], [3, 51], [7, 54], [10, 58], [5, 62], [14, 69],
    [28, 71], [40, 68], [55, 69], [70, 73], [85, 76], [100, 77], [115, 75], [130, 73],
    [145, 72], [160, 70], [172, 67], [180, 65], [170, 60], [162, 58], [155, 52], [142, 52],
    [140, 44], [132, 43], [126, 40], [122, 38], [122, 31], [118, 25], [112, 21], [106, 18],
    [109, 12], [105, 9], [100, 10], [99, 15], [95, 16], [92, 21], [88, 22], [82, 17],
    [77, 8], [73, 17], [70, 23], [66, 25], [57, 25], [52, 17], [45, 13], [43, 17],
    [38, 23], [34, 30], [29, 33], [27, 37], [23, 36], [20, 40], [14, 41], [12, 37],
    [8, 44], [3, 43], [-2, 37], [-6, 36], [-10, 36],
  ],
  // Africa
  [
    [-17, 15], [-16, 22], [-10, 29], [-5, 36], [10, 37], [20, 32], [32, 31], [35, 24],
    [39, 15], [43, 12], [51, 12], [43, 2], [40, -5], [39, -11], [35, -19], [33, -26],
    [27, -34], [20, -35], [15, -23], [12, -16], [9, -1], [5, 5], [-5, 5], [-16, 12], [-17, 15],
  ],
  // Arabian peninsula detail (overlaps Asia edge)
  [[35, 29], [48, 29], [56, 25], [52, 17], [44, 12], [38, 17], [35, 29]],
  // Madagascar
  [[44, -13], [50, -15], [50, -24], [45, -25], [43, -19], [44, -13]],
  // Japan
  [[130, 32], [137, 34], [141, 40], [145, 44], [141, 42], [137, 37], [132, 34], [130, 32]],
  // Indonesia / Philippines (dots of land)
  [[95, 5], [103, 2], [106, -5], [100, -2], [95, 5]],
  [[109, 1], [117, 4], [119, -3], [110, -4], [109, 1]],
  [[124, 8], [126, 1], [120, -6], [116, -4], [122, 2], [124, 8]],
  [[120, 18], [124, 18], [126, 7], [121, 6], [120, 18]],
  [[131, -1], [141, -3], [150, -9], [144, -8], [134, -4], [131, -1]],
  // Australia
  [
    [113, -23], [114, -33], [118, -35], [129, -32], [137, -35], [141, -38], [147, -38],
    [150, -37], [153, -28], [146, -19], [142, -11], [136, -12], [130, -12], [126, -14],
    [122, -17], [113, -23],
  ],
  // New Zealand
  [[173, -35], [178, -38], [174, -41], [170, -44], [166, -46], [171, -42], [173, -35]],
  // Antarctica
  [
    [-180, -72], [-150, -75], [-120, -73], [-90, -72], [-60, -63], [-30, -70], [0, -70],
    [30, -68], [60, -67], [90, -66], [120, -66], [150, -70], [180, -72], [180, -90], [-180, -90],
  ],
];

function pointInPolygon(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when (lon, lat) falls on a generated landmass (continent approximation). */
export function isLand(lon: number, lat: number): boolean {
  for (const ring of LAND) if (pointInPolygon(lon, lat, ring)) return true;
  return false;
}

/** Land mask at low resolution (720×360), used for the dotted globe/backdrop. */
export function landMask(width = 720): Uint8Array {
  const height = width / 2;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const lat = 90 - ((y + 0.5) / height) * 180;
    for (let x = 0; x < width; x++) {
      const lon = -180 + ((x + 0.5) / width) * 360;
      if (isLand(lon, lat)) mask[y * width + x] = 1;
    }
  }
  return mask;
}

/**
 * Globe surface: a DENSE TANGLE OF BRIGHT FILAMENTS WITH NODES.
 *
 * The reference artwork is not a lat/long graticule — it is a fibre-optic /
 * network sphere: pale mint-white curved strands criss-crossing in every
 * direction with small bright nodes where they meet, densest at the limb and
 * thinning slightly toward the face centre.
 *
 * SYNTHETIC and decorative: it is a generated texture, not satellite imagery,
 * and is labelled "BASE TEXTURE — NOT SATELLITE OBSERVATION" on screen.
 */
export function createBaseEarthTexture(width = 2048, height = 1024): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Deep near-black green bed. Kept almost black: the artwork's contrast comes
  // from bright strands on a dark body, so the bed must stay dark.
  ctx.fillStyle = '#010805';
  ctx.fillRect(0, 0, width, height);

  // Body: mid-bright MILKY disc. Measured artwork interior runs 120–150 with
  // visible dark gaps between the rings — not a uniform white field. Keeping the
  // base darker lets the rings carry the brightness and keeps gaps readable.
  const body = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, height * 0.5);
  body.addColorStop(0.0, 'rgba(26,74,48,0.58)');
  body.addColorStop(0.5, 'rgba(34,98,62,0.60)');
  body.addColorStop(0.82, 'rgba(54,132,88,0.64)');
  body.addColorStop(1.0, 'rgba(78,172,120,0.70)');
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, width, height);

  // Deterministic PRNG so the sphere looks identical on every reload/screenshot.
  let seed = 20240917;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const TAU = Math.PI * 2;

  /**
   * The artwork's sphere is built from OVERLAPPING ELLIPSE RINGS, not wandering
   * strands: each element is a closed loop that sweeps across the face and
   * crosses the others, weaving a lattice of thin bright ellipses.
   * Ellipses are drawn in equirectangular space, so on the sphere they curve.
   */
  const drawRings = (count: number, alpha: number, lineW: number) => {
    for (let n = 0; n < count; n++) {
      const cxr = rnd() * width;
      const cyr = height * (0.12 + rnd() * 0.76);
      const rx = (0.09 + rnd() * 0.30) * width;
      const ry = (0.16 + rnd() * 0.46) * height;
      const rot = (rnd() - 0.5) * 1.1;
      const tilt = (rnd() - 0.5) * 0.9;
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * TAU;
        const ex = Math.cos(a) * rx;
        const ey = Math.sin(a) * ry;
        // slight tilt squash so rings do not all read as flat ovals
        const x = cxr + ex * Math.cos(rot) - ey * Math.sin(rot);
        const y = cyr + ex * Math.sin(rot) * 0.35 + ey * Math.cos(rot) * (1 - Math.abs(tilt) * 0.3);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${170 + Math.floor(rnd() * 70)},255,${210 + Math.floor(rnd() * 45)},${alpha})`;
      ctx.lineWidth = lineW * (0.65 + rnd() * 0.8);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  };

  // Two passes: a faint wide halo behind each ring, then the crisp bright core.
  // The reference sphere is far denser than a sparse lattice - filaments nearly
  // fill it at the limb - so draw many more, finer strokes.
  ctx.globalCompositeOperation = 'lighter';
  drawRings(150, 0.12, 2.6);
  drawRings(320, 0.42, 0.9);

  // Small crisp dots scattered between the rings.
  for (let i = 0; i < 420; i++) {
    const x = rnd() * width;
    const y = height * (0.05 + rnd() * 0.90);
    const r = 1.2 + rnd() * 2.0;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = `rgba(240,255,250,${0.65 + rnd() * 0.35})`;
    ctx.fill();
  }

  // Pinch the extreme pole rows to the local colour: those rows collapse to a
  // single sphere vertex, so a flat fill here prevents a visible cap artifact.
  ctx.globalCompositeOperation = 'source-over';
  const band = Math.max(2, Math.round(height * 0.008));
  const sample = ctx.getImageData(0, band + 1, 1, 1).data;
  ctx.fillStyle = `rgb(${sample[0]},${sample[1]},${sample[2]})`;
  ctx.fillRect(0, 0, width, band);
  ctx.fillRect(0, height - band, width, band);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Blue-marble style fallback used when a GIBS tile fails (never shown as "live"). */
export function createTileFailureTexture(size = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#03110a';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,86,0,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size * 0.3, size * 0.3);
  ctx.lineTo(size * 0.7, size * 0.7);
  ctx.moveTo(size * 0.7, size * 0.3);
  ctx.lineTo(size * 0.3, size * 0.7);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createAtmosphereTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Wide, low bloom: bright right outside the limb (≈0.62 of the shell radius
  // once the shell is 1.62x the sphere) then fading to nothing.
  // Shell is 1.9x the sphere ⇒ the limb sits at 1/1.9 ≈ 0.526 of the radius.
  // Reference bloom: nearly nothing over the disc, a soft haze just outside
  // the limb, then a long fade out to the shell edge.
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(18,110,60,0.0)');
  g.addColorStop(0.42, 'rgba(20,120,64,0.0)');
  g.addColorStop(0.5, 'rgba(24,140,74,0.10)');
  g.addColorStop(0.545, 'rgba(34,175,92,0.24)');
  g.addColorStop(0.60, 'rgba(28,150,80,0.12)');
  g.addColorStop(0.72, 'rgba(22,120,64,0.05)');
  g.addColorStop(0.88, 'rgba(18,100,54,0.015)');
  g.addColorStop(1, 'rgba(16,90,48,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Glowing dot sprite for markers. */
export function createGlowSprite(color: string, size = 64): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Soft round sprite used for the dotted landmass shell on the globe so the
 * dots fade with distance and keep the HUD glow.
 */
export function createDotSprite(size = 32): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(210,255,225,1)');
  g.addColorStop(0.45, 'rgba(90,255,160,0.75)');
  g.addColorStop(1, 'rgba(57,255,136,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Smoky aurora plume draped just outside the sphere silhouette.
 *
 * The reference globe is not ringed by an even glow: a diffuse, billowing
 * plume sweeps around the lower-right limb and fades out top-left. A radial
 * gradient cannot express that, so this builds an off-centre, noisy ribbon.
 * Purely decorative — it is labelled as such in the Layers panel and carries
 * no measurement.
 */
export function createAuroraTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;



  // Single smooth falloff. Stacked gradients/arcs each leave their own visible
  // boundary under additive blending, so this is deliberately ONE pass.
  // It reaches exactly zero at the texture edge — a sprite is clipped to its
  // rectangle, and any residue there shows as a hard square.
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(40,200,112,0.0)');
  g.addColorStop(0.34, 'rgba(44,212,120,0.22)'); // begins just outside the sphere
  g.addColorStop(0.46, 'rgba(50,228,130,0.30)');
  g.addColorStop(0.60, 'rgba(36,175,98,0.13)');
  g.addColorStop(0.78, 'rgba(26,135,72,0.04)');
  g.addColorStop(0.90, 'rgba(20,110,60,0.012)');
  g.addColorStop(1, 'rgba(16,90,48,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // Directional bias: the reference glow is heavier on the right and lower
  // right. Applied as a multiply on the existing alpha, so no new edge is
  // introduced.
  ctx.globalCompositeOperation = 'destination-in';
  const bias = ctx.createLinearGradient(c, 0, size, size);
  bias.addColorStop(0, 'rgba(0,0,0,0.45)');
  bias.addColorStop(0.5, 'rgba(0,0,0,0.85)');
  bias.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = bias;
  ctx.fillRect(0, 0, size, size);

  // Punch out the disc so the halo never washes over the mesh. The fade is
  // deliberately wide: a hard edge here shows as a stack of crescents.
  ctx.globalCompositeOperation = 'destination-out';
  const hole = ctx.createRadialGradient(c, c, 0, c, c, size * 0.42);
  hole.addColorStop(0, 'rgba(0,0,0,1)');
  hole.addColorStop(0.62, 'rgba(0,0,0,1)');
  hole.addColorStop(0.86, 'rgba(0,0,0,0.45)');
  hole.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hole;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
