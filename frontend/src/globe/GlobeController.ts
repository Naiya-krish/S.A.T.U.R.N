/**
 * Imperative bridge between React/Zustand and the Three.js scene.
 * The scene never reads React state directly; the app pushes snapshots in.
 */

import type { LocationCandidate, OverlayId } from '../state/types';
import type { GlobeScene, GlobeSnapshot, ImageryPlan } from './GlobeScene';

let scene: GlobeScene | null = null;

export interface FlyOptions {
  durationMs?: number;
  reducedMotion?: boolean;
}

export const globe = {
  attach(s: GlobeScene | null) {
    scene = s;
  },
  get ready() {
    return scene !== null;
  },
  flyTo(lat: number, lon: number, altitudeKm?: number, opts?: FlyOptions) {
    scene?.flyTo({ lat, lon, altitudeKm, ...opts });
  },
  setCamera(phi: number, theta: number, altitudeKm?: number, animate = false) {
    scene?.setCamera(phi, theta, altitudeKm, animate);
  },
  resetView(opts?: FlyOptions) {
    scene?.resetView(opts);
  },
  setOverlay(id: OverlayId, on: boolean) {
    scene?.setOverlay(id, on);
  },
  setOpacity(v: number) {
    scene?.setOpacity(v);
  },
  setHighlight(
    loc: Pick<LocationCandidate, 'lat' | 'lon'> | null,
    rings: [number, number][][],
    label?: string | null,
  ) {
    scene?.setHighlight(loc, rings, label ?? null);
  },
  setLandmarks(points: { name: string; lat: number; lon: number; lonSpan: number }[]) {
    scene?.setLandmarks(points);
  },
  setComparison(mode: 'split' | 'swipe' | 'off', position: number) {
    scene?.setComparison(mode, position);
  },

  setEvents(points: { id: string; lat: number; lon: number; category: string; title: string }[]) {
    scene?.setEvents(points);
  },
  setFires(points: { id: string; lat: number; lon: number; confidence: string | null }[]) {
    scene?.setFires(points);
  },
  /** Diagnostics: what is actually in the scene graph right now. */
  debugScene(): { fires: number; fireVisible: boolean; events: number } | null {
    return scene?.debugCounts() ?? null;
  },
  speedKmS(): number {
    return scene?.angularSpeedKmS() ?? 0;
  },
  loadImagery(plan: ImageryPlan | null) {
    scene?.loadImagery(plan);
  },
  snapshot(): GlobeSnapshot | null {
    return scene?.getSnapshot() ?? null;
  },
  reducedMotion(): boolean {
    return scene?.prefersReducedMotion() ?? false;
  },
};
