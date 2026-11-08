/**
 * GlobeScene — the custom Three.js Earth used in the center of the console.
 *
 * Features
 *  * wire/dot green HUD globe with rings, mesh, atmosphere glow and starfield
 *  * orbit-style rotate + wheel/pinch zoom with inertia (touch friendly)
 *  * flyTo(lat, lon, altitudeKm) with easing, resetView(), reduced-motion aware
 *  * real NASA GIBS WMTS tiles projected onto the sphere
 *  * boundary outlines, event/fire markers, landmark labels (HUD)
 *  * split-date comparison group (two real composite dates)
 */

import * as THREE from 'three';
import { DEG2RAD, latLonToVector3, shortestAngle } from '../geo/coords';
import type { OverlayId } from '../state/types';
import {
  createAtmosphereTexture,
  createAuroraTexture,
  createBaseEarthTexture,
  createDotSprite,
  createGlowSprite,
} from './textures';

export interface GlobeSnapshot {
  lat: number;
  lon: number;
  altitudeKm: number;
  phi: number;
  theta: number;
  pixelRatio: number;
  imageryLoaded: boolean;
  tilesRequested: number;
  tilesLoaded: number;
  tilesFailed: number;
}

export interface ImageryPlan {
  layer_id: string;
  date: string;
  tile_template: string;
  max_zoom: number;
  /** MIME type from the GIBS capabilities, used to resolve the {ext} token. */
  format?: string;
}

export interface GlobeCallbacks {
  onCamera?: (lat: number, lon: number, altitudeKm: number, animating: boolean) => void;
  onTileStatus?: (loaded: number, requested: number, failed: number) => void;
}

interface FlyTarget {
  theta: number;
  phi: number;
  altKm: number;
  startTheta: number;
  startPhi: number;
  startAlt: number;
  start: number;
  duration: number;
}

const BASE_RADIUS = 1;
const TILE_PX = 256;


const DEFAULT_VIEW = { lat: 22.4, lon: 10.2, altitudeKm: 16200 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class GlobeScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raf = 0;
  private disposed = false;

  private globeGroup = new THREE.Group();
  private earth!: THREE.Mesh;
  private baseMaterial!: THREE.MeshBasicMaterial;
  private baseTexture!: THREE.CanvasTexture;
  private atmosphere!: THREE.Mesh;
  private rim!: THREE.Sprite;
  private orbitRings = new THREE.Group();
  private ringsGroup = new THREE.Group();
  private gridRing!: THREE.Line;
  private meshLines!: THREE.LineSegments;
  private dots!: THREE.LineSegments;

  private highlightGroup = new THREE.Group();
  private markerGroup = new THREE.Group();
  private eventGroup = new THREE.Group();
  private fireGroup = new THREE.Group();
  private landmarkGroup = new THREE.Group();
  private labelEls = new Map<string, HTMLDivElement>();
  private labelLayer: HTMLDivElement;

  private imageryGroup = new THREE.Group();
  private comparativeGroup = new THREE.Group();
  private tileMaterial: THREE.MeshBasicMaterial;

  private tiles = new Map<string, THREE.Texture>();
  private tilePromises = new Map<string, Promise<THREE.Texture>>();
  private plan: ImageryPlan | null = null;
  private stats = { requested: 0, loaded: 0, failed: 0 };
  private patchKey = '';

  private theta = 2.0;
  private phi = 1.17;
  private altitudeKm = DEFAULT_VIEW.altitudeKm;

  private pointers = new Map<number, { x: number; y: number }>();
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private pinchDistance = 0;
  private velTheta = 0;
  private velPhi = 0;
  private fly: FlyTarget | null = null;
  private interactUntil = 0;

  private callbacks: GlobeCallbacks = {};
  private resizeObserver: ResizeObserver;
  private labelClock = 0;
  private reduced: boolean;
  private overlays: Record<string, boolean> = { grid: true, network: true, labels: true, events: false, fires: false };

  constructor(container: HTMLElement) {
    this.container = container;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    Object.assign(this.labelLayer.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
      overflow: 'hidden',
    });
    container.appendChild(this.labelLayer);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 120);
    this.scene.add(this.globeGroup);

    this.tileMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    // Reference sphere is very dark: RGB ≈ (3,25,13) with faint limbs. Unlit
    // material so the canvas texture IS the look (no lighting blow-out).
    this.baseMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: false,
    });

    this.buildStars();
    this.buildGlobe();
    this.buildRings();
    this.scene.add(this.highlightGroup, this.markerGroup, this.eventGroup, this.fireGroup, this.landmarkGroup);

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.animate();
  }

  // ────────────────────────────── build ──────────────────────────────
  /** Seeded starfield around the whole scene (decorative). */
  private buildStars() {
    let seed = 1337;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const count = 2600;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 9 + rnd() * 26;
      const t = rnd() * Math.PI * 2;
      const p = Math.acos(2 * rnd() - 1);
      positions[i * 3] = r * Math.sin(p) * Math.cos(t);
      positions[i * 3 + 1] = r * Math.cos(p) * 0.7;
      positions[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
      sizes[i] = rnd() > 0.94 ? 0.045 : rnd() > 0.6 ? 0.028 : 0.016;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.scene.add(
      new THREE.Points(
        geo,
        new THREE.PointsMaterial({
          color: 0xa8ffcc,
          size: 0.022,
          map: createDotSprite(),
          transparent: true,
          opacity: 0.32,
          sizeAttenuation: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    void sizes;
  }

  private buildGlobe() {
    this.baseTexture = createBaseEarthTexture(4096, 2048);
    this.baseMaterial.map = this.baseTexture;
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(BASE_RADIUS, 160, 120), this.baseMaterial);
    this.globeGroup.add(this.earth);

    // Outer halo: measured artwork has almost NO bloom outside the limb — the
    // region past r≈68 sits at avgG≈38. Keep this very tight and weak.
    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(BASE_RADIUS * 1.06, 64, 48),
      new THREE.MeshBasicMaterial({
        map: createAtmosphereTexture(),
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        opacity: 0.40,
      }),
    );
    this.atmosphere.renderOrder = -1;
    this.globeGroup.add(this.atmosphere);

    // Wide orbit rings that cross IN FRONT of the sphere (tilted ellipses in
    // the reference). Decorative, labelled in the Layers panel.
    const orbitRing = (tiltX: number, tiltZ: number, radius: number, opacity: number, color: number) => {
      const pts = Array.from({ length: 180 }, (_, i) => {
        const a = (i / 180) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      });
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ring.rotation.x = tiltX;
      ring.rotation.z = tiltZ;
      return ring;
    };
    // The reference artwork is gentle horizontal-ish ellipses seen edge-on,
    // sweeping wide across the disc — only two, both very faint.
    this.orbitRings.add(orbitRing(1.34, 0.06, 1.7, 0.16, 0x39ff88));
    this.orbitRings.add(orbitRing(1.48, -0.22, 2.05, 0.09, 0x2fb86b));

    // Large faint concentric arcs well outside the sphere (the artwork shows
    // several sweeping rings that extend far into the background plane).
    for (const [rad, op] of [
      [2.6, 0.10],
      [3.3, 0.07],
      [4.1, 0.05],
    ] as [number, number][]) {
      this.orbitRings.add(orbitRing(1.25, 0.02, rad, op, 0x39ff88));
    }
    this.globeGroup.add(this.orbitRings);

    // Aurora plume: a screen-facing billowing wash around the lit limb. The
    // reference has no crisp glowing ring around the sphere — this replaces
    // one with the diffuse, off-centre glow it actually shows.
    this.rim = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createAuroraTexture(512),
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        opacity: 0.9,
      }),
    );
    // Sprite spans 2 units per world unit. Scaled tight to the limb so it reads
    // as a rim bloom rather than a field-filling wash.
    this.rim.scale.setScalar(2.12);
    this.rim.position.set(0, 0, 0);
    this.rim.renderOrder = -1;
    this.globeGroup.add(this.rim);

    this.imageryGroup.renderOrder = 2;
    this.globeGroup.add(this.imageryGroup, this.comparativeGroup);

    // Fine graticule: thin ~10° meridians and parallels across the whole
    // sphere (the reference shows a fine wire mesh, not a coarse cage).
    const seg: THREE.Vector3[] = [];
    const R = BASE_RADIUS * 1.0018;
    const push = (lat: number, lon: number) => {
      const v = latLonToVector3(lat, lon, R);
      seg.push(new THREE.Vector3(v.x, v.y, v.z));
    };
    // Reference graticule: a ~10° grid over the whole sphere, INCLUDING the
    // poles. Meridians run to ±87°: they must nearly reach the poles or the cap
    // is left as an empty hole. Stopping a few degrees short avoids stacking
    // every line on one point, which additive blending burns into a bright cap.
    const LAT_LIMIT = 87;
    const GRID = 10;
    for (let lat = -80; lat <= 80; lat += GRID) {
      for (let lon = -180; lon < 180; lon += 2) {
        push(lat, lon);
        push(lat, lon + 2);
      }
    }
    for (let lon = -180; lon < 180; lon += GRID) {
      for (let lat = -LAT_LIMIT; lat < LAT_LIMIT; lat += 2) {
        push(lat, lon);
        push(lat + 2, lon);
      }
    }
    this.dots = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(seg),
      new THREE.LineBasicMaterial({
        color: 0x3fe58c,
        transparent: true,
        opacity: 0.17,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    // The artwork sphere is a filament tangle, not a lat/long grid: the graticule
    // stays available for the GRID overlay toggle but is OFF by default.
    this.dots.visible = false;
    this.globeGroup.add(this.dots);

    // Prime meridian is only marginally brighter than its neighbours in the
    // reference — no white "equator bar".
    const meridian: THREE.Vector3[] = [];
    for (let lat = -87; lat <= 87; lat += 1.5) {
      const v = latLonToVector3(lat, 0, BASE_RADIUS * 1.004);
      meridian.push(new THREE.Vector3(v.x, v.y, v.z));
    }
    this.globeGroup.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(meridian),
        new THREE.LineBasicMaterial({
          color: 0x8fffc0,
          transparent: true,
          opacity: 0.24,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );

    // Cross ticks at each mesh intersection (the reference has these).
    const ticks: number[] = [];
    const tickR = BASE_RADIUS * 1.0026;
    const addPt = (arr: number[], lat: number, lon: number) => {
      const v = latLonToVector3(lat, lon, tickR);
      arr.push(v.x, v.y, v.z);
    };
    // Ticks are TINY and dim: at full length they pile up additively at each
    // node and read as bright squares instead of the reference's small crosses.
    // Parallels are skipped at ±80° (their ticks crowd the visible pole cap).
    for (let lat = -80; lat <= 80; lat += 10) {
      const dLat = 0.26;
      const dLon = 0.26 / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
      for (let lon = -180; lon < 180; lon += 10) {
        addPt(ticks, lat - dLat, lon);
        addPt(ticks, lat + dLat, lon);
        addPt(ticks, lat, lon - dLon);
        addPt(ticks, lat, lon + dLon);
      }
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
    this.gridRing = new THREE.LineSegments(
      tickGeo,
      new THREE.LineBasicMaterial({
        color: 0x7dffb2,
        transparent: true,
        opacity: 0.30,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.gridRing.visible = false;
    this.globeGroup.add(this.gridRing);
  }

  private buildRings() {
    this.ringsGroup.rotation.x = Math.PI / 2;
    // Reference: a thin ring at ~1.30r broken by long gaps, plus a sparse
    // ticked ring at ~1.37r. Everything else is faint.
    const arcs: [number, number, number, number][] = [
      // radius, opacity, startFraction, lengthFraction
      [1.3, 0.26, 0.02, 0.2],
      [1.3, 0.22, 0.3, 0.16],
      [1.3, 0.26, 0.56, 0.22],
      [1.3, 0.18, 0.86, 0.1],
    ];
    for (const [r, opacity, start, len] of arcs) {
      const geo = new THREE.RingGeometry(r, r + 0.0022, 160, 1, start * Math.PI * 2, len * Math.PI * 2);
      this.ringsGroup.add(
        new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity, side: THREE.DoubleSide })),
      );
    }
    this.ringsGroup.add(
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 256 }, (_, i) => {
            const a = (i / 256) * Math.PI * 2;
            return new THREE.Vector3(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0);
          }),
        ),
        new THREE.LineBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.1 }),
      ),
    );

    const ringTicks: THREE.Vector3[] = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const r1 = i % 4 === 0 ? 1.3 : 1.315;
      ringTicks.push(new THREE.Vector3(Math.cos(a) * r1, Math.sin(a) * r1, 0));
      ringTicks.push(new THREE.Vector3(Math.cos(a) * 1.33, Math.sin(a) * 1.33, 0));
    }
    this.ringsGroup.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(ringTicks),
        new THREE.LineBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.28 }),
      ),
    );

    const orbit: THREE.Vector3[] = [];
    for (let k = -60; k <= 60; k += 30) {
      const lat = k * DEG2RAD;
      for (let i = 0; i < 64; i++) {
        const a1 = (i / 64) * Math.PI * 2;
        const a2 = ((i + 1) / 64) * Math.PI * 2;
        orbit.push(new THREE.Vector3(Math.cos(lat) * Math.cos(a1), Math.sin(lat), Math.cos(lat) * Math.sin(a1)).multiplyScalar(1.1));
        orbit.push(new THREE.Vector3(Math.cos(lat) * Math.cos(a2), Math.sin(lat), Math.cos(lat) * Math.sin(a2)).multiplyScalar(1.1));
      }
    }
    this.meshLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(orbit),
      new THREE.LineBasicMaterial({ color: 0x1f8a4c, transparent: true, opacity: 0.18 }),
    );
    this.ringsGroup.add(this.meshLines);
    this.scene.add(this.ringsGroup);
  }

  // ────────────────────────────── camera ─────────────────────────────
  setCallbacks(cb: GlobeCallbacks) {
    this.callbacks = cb;
  }

  private cameraDistance(): number {
    // Fill factor maps altitude to a comfortable framing distance.
    const withFov = 1 / Math.sin((this.camera.fov * DEG2RAD) / 2);
    const orbit = 1 + this.altitudeKm / 6371;
    const factor = 1 + Math.log10(orbit) * 0.32;
    // 1.14 frames the disc; 1.30 pulls it back so the disc is ~19.6% of frame
    // height, matching exactly what docs/reference/The main reference.png
    // measures (1021x507, disc radius 99px = 19.5% of the 507px height).
    return withFov * 1.14 * 1.30 * factor;
  }

  private applyCamera() {
    const r = this.cameraDistance();
    this.camera.position.set(
      r * Math.sin(this.phi) * Math.sin(this.theta),
      r * Math.cos(this.phi),
      r * Math.sin(this.phi) * Math.cos(this.theta),
    );
    this.camera.lookAt(0, 0, 0);
  }

  private getLatLon(): { lat: number; lon: number } {
    const lat = clamp(90 - (this.phi * 180) / Math.PI, -90, 90);
    const raw = (this.theta * 180) / Math.PI - 180;
    const lon = ((((raw + 180) % 360) + 360) % 360) - 180;
    return { lat, lon: lon === -180 ? 180 : lon };
  }

  private polarFrom(lat: number, lon: number): { phi: number; theta: number } {
    const twoPi = Math.PI * 2;
    return {
      phi: clamp((90 - clamp(lat, -89.9, 89.9)) * DEG2RAD, 0.05, Math.PI - 0.05),
      theta: (((lon + 180) * DEG2RAD) % twoPi + twoPi) % twoPi,
    };
  }

  getSnapshot(): GlobeSnapshot {
    const { lat, lon } = this.getLatLon();
    return {
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
      altitudeKm: Math.round(this.altitudeKm),
      phi: this.phi,
      theta: this.theta,
      pixelRatio: this.renderer.getPixelRatio(),
      imageryLoaded: this.plan !== null,
      tilesRequested: this.stats.requested,
      tilesLoaded: this.stats.loaded,
      tilesFailed: this.stats.failed,
    };
  }

  flyTo(opts: { lat: number; lon: number; altitudeKm?: number; durationMs?: number; reducedMotion?: boolean }) {
    const target = this.polarFrom(opts.lat, opts.lon);
    const currentDeg = (this.theta * 180) / Math.PI;
    const targetDeg = (target.theta * 180) / Math.PI;
    const delta = shortestAngle(currentDeg, targetDeg) * DEG2RAD;
    const reduced = opts.reducedMotion ?? this.reduced;
    this.fly = {
      theta: this.theta + delta,
      phi: target.phi,
      altKm: clamp(opts.altitudeKm ?? this.altitudeKm, 420, 34000),
      startTheta: this.theta,
      startPhi: this.phi,
      startAlt: this.altitudeKm,
      start: performance.now(),
      duration: reduced ? 1 : opts.durationMs ?? 2400,
    };
    this.velTheta = 0;
    this.velPhi = 0;
  }

  setCamera(phi: number, theta: number, altitudeKm?: number, animate = false) {
    const lat = 90 - (phi * 180) / Math.PI;
    const lon = (((theta * 180) / Math.PI - 180 + 540) % 360) - 180;
    if (animate) this.flyTo({ lat, lon, altitudeKm });
    else {
      this.fly = null;
      this.phi = clamp(phi, 0.05, Math.PI - 0.05);
      this.theta = theta;
      if (altitudeKm !== undefined) this.altitudeKm = clamp(altitudeKm, 420, 34000);
    }
  }

  resetView(opts?: { reducedMotion?: boolean }) {
    this.flyTo({ ...DEFAULT_VIEW, durationMs: 2000, reducedMotion: opts?.reducedMotion });
  }

  // ────────────────────────────── layers ─────────────────────────────
  setOpacity(v: number) {
    this.tileMaterial.opacity = clamp(v, 0, 1);
  }

  setOverlay(id: OverlayId | string, on: boolean) {
    this.overlays[id] = on;
    if (id === 'grid') {
      this.gridRing.visible = on;
      this.meshLines.visible = on;
      this.dots.visible = on;
    }
    if (id === 'labels') {
      this.landmarkGroup.visible = on;
      this.labelLayer.style.display = on ? 'block' : 'none';
    }
    if (id === 'events') this.eventGroup.visible = on;
    if (id === 'fires') this.fireGroup.visible = on;
  }

  prefersReducedMotion() {
    return this.reduced;
  }

  /** Diagnostics for the debug bridge: counts actually present in the scene. */
  debugCounts(): { fires: number; fireVisible: boolean; events: number } {
    return {
      fires: this.fireGroup.children.length,
      fireVisible: this.fireGroup.visible,
      events: this.eventGroup.children.length,
    };
  }

  // ─────────────────────────────── imagery ───────────────────────────────
  private refreshing = false;

  private async refreshImagery() {
    const plan = this.plan;
    if (!plan || this.disposed || this.refreshing) return;
    this.refreshing = true;
    try {
      await this._refreshImagery(plan);
    } finally {
      this.refreshing = false;
    }
  }

  /**
   * Maps real imagery onto the whole sphere as a single equirectangular overlay.
   *
   * An earlier implementation tiled a small patch and rebuilt it as the camera
   * moved. That produced vertical slivers: the patch spanned the full 360° of
   * longitude while its canvas held only a few tiles, so the texture was
   * squeezed and the synthetic wire shell showed through the gaps.
   *
   * Compositing one whole-world image removes that class of bug entirely: the
   * texture's UVs are the sphere's own UVs, so geography lands where it should
   * with no seam handling.
   */
  private async _refreshImagery(plan: ImageryPlan) {
    // Whole-world zoom: enough detail to read continents, few enough tiles to
    // load quickly. z=2 => 4x4 = 16 tiles for the entire planet.
    const z = clamp(2, 1, plan.max_zoom);
    const key = `${plan.layer_id}|${plan.date}|${z}|world`;
    if (key === this.patchKey) return;
    this.patchKey = key;
    const tex = await this.getWorldTexture(plan, z);
    if (this.disposed || key !== this.patchKey) return;

    // A sphere UV-mapped with the world image; radius just above the base so it
    // wins the depth test without z-fighting.
    const geo = new THREE.SphereGeometry(BASE_RADIUS * 1.002, 128, 96);
    const mat = this.tileMaterial.clone();
    mat.map = tex;
    mat.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;

    for (const old of [...this.imageryGroup.children]) {
      this.imageryGroup.remove(old);
      const m = old as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.imageryGroup.add(mesh);
    // Real imagery replaces the synthetic filament shell.
    this.dots.visible = false;
    this.earth.visible = false;
  }

  /** Composites the whole world at zoom z into a 2:1 equirectangular texture. */
  private getWorldTexture(plan: ImageryPlan, z: number): Promise<THREE.Texture> {
    const key = `${plan.layer_id}|${plan.date}|${z}|world`;
    const hit = this.tiles.get(key);
    if (hit) return Promise.resolve(hit);
    const pending = this.tilePromises.get(key);
    if (pending) return pending;

    const n = 2 ** z;
    // Build a true 2:1 EQUIRECTANGULAR canvas and place each Web-Mercator tile
    // at the latitude band it actually covers. A Mercator world is square and
    // only spans ±85.05°, so blitting it straight onto sphere UVs over-stretched
    // the poles and left a black polar cap plus wedge-shaped gaps.
    const W = n * TILE_PX;
    const H = W / 2;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0a2a18';
    ctx.fillRect(0, 0, W, H);

    // Web-Mercator row index -> latitude -> equirectangular y.
    const latOfRow = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
    const yOfLat = (lat: number) => ((90 - lat) / 180) * H;

    const jobs: Promise<void>[] = [];
    for (let ty = 0; ty < n; ty++) {
      const latTop = latOfRow(ty);
      const latBottom = latOfRow(ty + 1);
      const y0 = yOfLat(latTop);
      const dy = Math.max(1, yOfLat(latBottom) - y0);
      for (let tx = 0; tx < n; tx++) {
        const dx = TILE_PX;
        const x0 = tx * TILE_PX;
        const url = plan.tile_template
          .replace('{z}', String(z))
          .replace('{x}', String(tx))
          .replace('{y}', String(ty))
          .replace('{ext}', plan.format === 'image/png' ? 'png' : 'jpeg');
        jobs.push(
          new Promise<void>((resolve) => {
            this.stats.requested += 1;
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              this.stats.loaded += 1;
              try {
                // Each tile image is stretched over its own latitude band.
                ctx.drawImage(img, 0, 0, TILE_PX, TILE_PX, x0, y0, dx, dy);
              } catch {
                this.stats.failed += 1;
              }
              resolve();
            };
            img.onerror = () => {
              this.stats.failed += 1;
              this.callbacks.onTileStatus?.(this.stats.loaded, this.stats.requested, this.stats.failed);
              resolve();
            };
            img.src = url;
          }),
        );
      }
    }

    const promise = Promise.all(jobs).then(() => {
      // Fill the polar caps: the Mercator world stops at ±85.05°, so the top and
      // bottom rows of the equirectangular canvas would otherwise stay empty and
      // render as a black cap at the pole. Smearing the nearest observed row is
      // the honest option - it invents no new data - and the layer is labelled
      // as a daily composite everywhere it is shown.
      const capH = Math.max(1, Math.round(H * 0.03));
      ctx.drawImage(canvas, 0, 0, W, 1, 0, 0, W, capH);
      ctx.drawImage(canvas, 0, H - 1, W, 1, 0, H - capH, W, capH);
      (window as unknown as { __saturnPatch?: HTMLCanvasElement }).__saturnPatch = canvas;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.wrapS = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      this.tiles.set(key, tex);
      this.tilePromises.delete(key);
      this.callbacks.onTileStatus?.(this.stats.loaded, this.stats.requested, this.stats.failed);
      return tex;
    });
    this.tilePromises.set(key, promise);
    return promise;
  }

  loadImagery(plan: ImageryPlan | null) {
    this.stats = { requested: 0, loaded: 0, failed: 0 };
    this.patchKey = '';
    this.plan = plan;
    if (!plan) {
      this.disposeGroup(this.imageryGroup);
      // Back to the synthetic base look (clearly labelled as non-imagery).
      this.earth.visible = true;
      this.dots.visible = this.overlays.grid !== false;
      return;
    }
    void this.refreshImagery();
  }

  setComparison(mode: 'split' | 'swipe' | 'off', position: number) {
    void position;
    if (mode === 'off') this.disposeGroup(this.comparativeGroup);
  }

  // ────────────────────────────── overlays ───────────────────────────
  private disposeGroup(group: THREE.Group) {
    const keep = new Set<THREE.Material>([this.tileMaterial]);
    for (const child of [...group.children]) {
      group.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => !keep.has(m) && m.dispose());
      else if (mat && !keep.has(mat)) mat.dispose();
    }
  }

  setHighlight(loc: { lat: number; lon: number } | null, rings: [number, number][][], label: string | null) {
    this.disposeGroup(this.highlightGroup);
    this.disposeGroup(this.markerGroup);
    if (label) this.removeLabel('primary');
    if (!loc) return;
    const lineMat = new THREE.LineBasicMaterial({ color: 0x7dffb2, transparent: true, opacity: 0.95 });
    for (const ring of rings) {
      const pts = ring.map(([lon, lat]) => {
        const v = latLonToVector3(lat, lon, BASE_RADIUS * 1.006);
        return new THREE.Vector3(v.x, v.y, v.z);
      });
      if (pts.length > 1) this.highlightGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }
    const v = latLonToVector3(loc.lat, loc.lon, BASE_RADIUS * 1.012);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createGlowSprite('rgba(125,255,178,0.85)'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.position.set(v.x, v.y, v.z);
    glow.scale.setScalar(0.1);
    this.markerGroup.add(glow);
    if (label) this.addLabel(label, loc.lat, loc.lon, 'primary');
    this.landmarkGroup.visible = this.overlays.labels !== false;
  }

  setEvents(points: { id: string; lat: number; lon: number; category: string; title: string }[]) {
    this.disposeGroup(this.eventGroup);
    for (const p of points) {
      const color = /fire|volcan/i.test(p.category)
        ? 'rgba(255,138,61,0.9)'
        : /storm|cyclone/i.test(p.category)
          ? 'rgba(125,224,255,0.9)'
          : 'rgba(57,255,136,0.9)';
      const v = latLonToVector3(p.lat, p.lon, BASE_RADIUS * 1.012);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: createGlowSprite(color),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      sprite.position.set(v.x, v.y, v.z);
      sprite.scale.setScalar(0.045);
      this.eventGroup.add(sprite);
    }
  }

  setFires(points: { id: string; lat: number; lon: number; confidence: string | null }[]) {
    this.disposeGroup(this.fireGroup);
    if (!points.length) return;

    // Thermal anomalies render as glowing amber sprites on the surface. A plain
    // PointsMaterial at a small world-space size drew sub-pixel dots and was
    // effectively invisible; a sprite with sizeAttenuation scales with the view.
    const sprite = createGlowSprite('rgba(255,150,60,0.95)');
    for (const p of points) {
      const v = latLonToVector3(p.lat, p.lon, BASE_RADIUS * 1.004);
      const m = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: sprite,
          color: 0xffffff,
          transparent: true,
          depthWrite: false,
          depthTest: true,
          blending: THREE.AdditiveBlending,
          // High confidence burns brighter, which is what the badge means.
          opacity: p.confidence === 'l' ? 0.55 : 0.95,
        }),
      );
      m.position.set(v.x, v.y, v.z);
      // Scale relative to the globe radius so a detection reads as a marker at
      // any zoom. 0.024 world units was a few pixels and effectively invisible.
      m.scale.setScalar(p.confidence === 'l' ? 0.055 : 0.085);
      this.fireGroup.add(m);
    }
    this.fireGroup.visible = this.overlays.fires !== false;
  }

  setLandmarks(points: { name: string; lat: number; lon: number; lonSpan: number }[]) {
    this.disposeGroup(this.landmarkGroup);
    for (const p of points) this.addLabel(p.name, p.lat, p.lon, 'secondary');
    this.landmarkGroup.visible = this.overlays.labels !== false;
  }

  private removeLabel(kind: 'primary' | 'secondary') {
    for (const [k, el] of this.labelEls) {
      if (el.dataset.kind === kind) {
        el.remove();
        this.labelEls.delete(k);
      }
    }
  }

  private addLabel(text: string, lat: number, lon: number, kind: 'primary' | 'secondary') {
    const key = `${kind}:${text}:${lat.toFixed(3)}`;
    if (this.labelEls.has(key)) return;
    const el = document.createElement('div');
    el.className = `globe-label globe-label--${kind}`;
    el.textContent = text.toUpperCase();
    el.dataset.lat = String(lat);
    el.dataset.lon = String(lon);
    el.dataset.kind = kind;
    this.labelLayer.appendChild(el);
    this.labelEls.set(key, el);
  }

  private updateLabels() {
    const rect = this.container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const v = new THREE.Vector3();
    const globeCenter = new THREE.Vector3();
    const camDir = this.camera.position.clone().normalize();
    for (const el of this.labelEls.values()) {
      const lat = Number(el.dataset.lat);
      const lon = Number(el.dataset.lon);
      const p = latLonToVector3(lat, lon, BASE_RADIUS * 1.02);
      void globeCenter;
      const facing = p.x * camDir.x + p.y * camDir.y + p.z * camDir.z;
      v.set(p.x, p.y, p.z).project(this.camera);
      const onScreen = v.z < 1 && v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1;
      if (facing <= 0.02 || !onScreen) {
        el.style.opacity = '0';
        continue;
      }
      el.style.opacity = '1';
      el.style.left = `${((v.x + 1) / 2) * rect.width}px`;
      el.style.top = `${((1 - v.y) / 2) * rect.height}px`;
    }
  }

  // ────────────────────────────── input ──────────────────────────────
  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.dragging = true;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.fly = null;
        this.interactUntil = performance.now() + 800;
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDistance > 0 && d > 0) this.zoomBy(this.pinchDistance / d);
        this.pinchDistance = d;
        return;
      }
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      const scale = 0.0042 * clamp(this.altitudeKm / 16000, 0.25, 1.6);
      this.theta -= dx * scale;
      this.phi = clamp(this.phi + dy * scale, 0.05, Math.PI - 0.05);
      this.velTheta = -dx * scale;
      this.velPhi = dy * scale;
      this.interactUntil = performance.now() + 1000;
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) this.dragging = false;
      this.pinchDistance = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomBy(1 + Math.sign(e.deltaY) * 0.11);
      },
      { passive: false },
    );
  }

  private zoomBy(factor: number) {
    this.altitudeKm = clamp(this.altitudeKm * factor, 420, 34000);
    this.interactUntil = performance.now() + 900;
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private animate = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    const now = performance.now();

    if (this.fly) {
      const t = Math.min(1, (now - this.fly.start) / this.fly.duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.theta = this.fly.startTheta + (this.fly.theta - this.fly.startTheta) * e;
      this.phi = this.fly.startPhi + (this.fly.phi - this.fly.startPhi) * e;
      this.altitudeKm = this.fly.startAlt + (this.fly.altKm - this.fly.startAlt) * e;
      if (t >= 1) this.fly = null;
    } else if (!this.dragging && now > this.interactUntil) {
      if (Math.abs(this.velTheta) > 1e-5 || Math.abs(this.velPhi) > 1e-5) {
        this.velTheta *= 0.93;
        this.velPhi *= 0.93;
        this.theta += this.velTheta;
        this.phi = clamp(this.phi + this.velPhi, 0.05, Math.PI - 0.05);
      }
    }

    this.applyCamera();
    if (!this.reduced) {
      const t = now / 1000;
      this.ringsGroup.rotation.z = t * 0.035;
      // Very slight breathing only — a large pulse washed out the limb contrast.
      (this.atmosphere.material as THREE.MeshBasicMaterial).opacity = 0.40 + Math.sin(t * 0.7) * 0.015;
    }

    const { lat, lon } = this.getLatLon();
    this.callbacks.onCamera?.(lat, lon, this.altitudeKm, !!this.fly);
    this.renderer.render(this.scene, this.camera);
    if (now - this.labelClock > 32) {
      this.labelClock = now;
      this.updateLabels();
      if (this.plan) void this.refreshImagery();
    }
  };

  /** Angular speed of the camera in km/s on the ground track (0 when idle). */
  angularSpeedKmS(): number {
    const v = Math.hypot(this.velTheta, this.velPhi);
    return v * 6371 * 0.9;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.labelEls.forEach((el) => el.remove());
    this.labelEls.clear();
    this.tiles.forEach((t) => t.dispose());
    this.tiles.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }
}
