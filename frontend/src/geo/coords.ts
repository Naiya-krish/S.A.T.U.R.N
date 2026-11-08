/**
 * Coordinate maths for the globe, HUD readouts and boundary drawing.
 * Latitudes are clamped/wrapped exactly like the backend (geo/coords.py).
 */

import { EARTH_RADIUS_KM } from '../config';
import type { Boundary, GeoPoint } from '../state/types';

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export class CoordinateError extends Error { }

export function wrapLongitude(lon: number): number {
  if (!Number.isFinite(lon)) throw new CoordinateError('Longitude must be a finite number.');
  const w = (((lon + 180) % 360) + 360) % 360 - 180;
  return w === -180 && lon > 0 ? 180 : w;
}

export function isValidLatitude(lat: unknown): lat is number {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lon: unknown): lon is number {
  return typeof lon === 'number' && Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

export function validateLatLon(lat: unknown, lon: unknown): GeoPoint {
  if (!isValidLatitude(lat)) throw new CoordinateError(`Latitude ${String(lat)} is outside -90..90.`);
  if (!isValidLongitude(lon)) throw new CoordinateError(`Longitude ${String(lon)} is outside -180..180.`);
  return { lat, lon };
}

/** Parses "12.9716, 77.5846" (comma / space / semicolon separated). */
export function parseCoordinates(text: string): GeoPoint | null {
  const m = text.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;/ ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m) return null;
  return validateLatLon(Number(m[1]), Number(m[2]));
}

export function mod360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function shortestAngle(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Spherical (lat, lon) -> Cartesian, radius = Earth radius * (1 + altitudeFraction). */
export function latLonToVector3(lat: number, lon: number, radius = 1): { x: number; y: number; z: number } {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lon + 180) * DEG2RAD;
  return {
    x: -radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta),
  };
}

export function vector3ToLatLon(x: number, y: number, z: number): GeoPoint {
  const r = Math.sqrt(x * x + y * y + z * z) || 1;
  const lat = 90 - Math.acos(y / r) * RAD2DEG;
  const lon = ((Math.atan2(z, -x) * RAD2DEG) - 180) * -1;
  return { lat, lon: wrapLongitude(lon > 180 ? lon - 360 : lon) };
}

/** Distance between two lat/lon points in km (haversine). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLon = shortestAngle(a.lon, b.lon) * DEG2RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG2RAD) * Math.cos(b.lat * DEG2RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Camera altitude (km) from an orbit radius in scene units. */
export function radiusToAltitudeKm(radiusUnits: number, baseRadius: number): number {
  return Math.max(0, (radiusUnits / baseRadius - 1) * EARTH_RADIUS_KM);
}

export function altitudeKmToRadius(altKm: number, baseRadius: number): number {
  return baseRadius * (1 + Math.max(0, altKm) / EARTH_RADIUS_KM);
}

/** Flattens GeoJSON coordinates into [lon, lat] pairs. */
export function flattenCoordinates(coords: unknown): [number, number][] {
  const out: [number, number][] = [];
  const walk = (c: unknown): void => {
    if (Array.isArray(c)) {
      if (c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
        out.push([c[0], c[1]]);
      } else c.forEach(walk);
    }
  };
  walk(coords);
  return out;
}

/** Splits a ring wherever it jumps the antimeridian, so lines never cross the globe. */
export function splitAntimeridian(ring: [number, number][]): [number, number][][] {
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (current.length) {
      const prev = current[current.length - 1];
      if (Math.abs(p[0] - prev[0]) > 180) {
        segments.push(current);
        current = [];
      }
    }
    current.push(p);
  }
  if (current.length) segments.push(current);
  return segments.filter((s) => s.length > 1);
}

export function boundaryRings(boundary: Boundary | null | undefined): [number, number][][] {
  if (!boundary) return [];
  const polys = boundary.type === 'MultiPolygon' ? (boundary.coordinates as unknown[]) : [boundary.coordinates];
  const rings: [number, number][][] = [];
  for (const poly of polys) {
    const first = Array.isArray(poly) ? (poly as unknown[])[0] : null;
    if (!first) continue;
    rings.push(flattenCoordinates(first));
  }
  return rings.flatMap(splitAntimeridian);
}

/** BBox (south, west, north, east) outline rings, antimeridian safe. */
export function bboxRings(bbox: [number, number, number, number]): [number, number][][] {
  const [s, w, n, e] = bbox;
  if (e >= w) {
    return [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
  }
  return [
    [[w, s], [180, s], [180, n], [w, n], [w, s]],
    [[-180, s], [e, s], [e, n], [-180, n], [-180, s]],
  ];
}

/**
 * Camera altitude needed to frame a bbox of the given spans (degrees).
 * Monotonic in span: a city gets a few hundred km, a continent tens of thousands.
 */
export function altitudeForSpan(latSpan: number, lonSpan: number): number {
  const span = Math.max(latSpan * 1.5, Math.abs(lonSpan) * 1.1, 0.004);
  const arcDeg = Math.min(170, span * 1.6);
  const half = (arcDeg / 2) * DEG2RAD;
  const altitude = EARTH_RADIUS_KM * (1 / Math.cos(half) - 1);
  return Math.max(420, Math.min(28000, altitude));
}

export function formatLat(lat: number): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
}

export function formatLon(lon: number): string {
  return `${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
}
