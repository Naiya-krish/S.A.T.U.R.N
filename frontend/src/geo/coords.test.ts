import { describe, expect, it } from 'vitest';
import {
  CoordinateError,
  altitudeForSpan,
  bboxRings,
  boundaryRings,
  flattenCoordinates,
  formatLat,
  formatLon,
  haversineKm,
  isValidLatitude,
  isValidLongitude,
  parseCoordinates,
  shortestAngle,
  splitAntimeridian,
  validateLatLon,
  wrapLongitude,
} from './coords';

describe('longitude handling', () => {
  it('wraps into (-180, 180]', () => {
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(-190)).toBe(170);
    expect(wrapLongitude(180)).toBe(180);
    expect(wrapLongitude(-180)).toBe(-180);
    expect(wrapLongitude(0)).toBe(0);
    expect(wrapLongitude(540)).toBe(180);
  });

  it('computes the shortest angular difference across the antimeridian', () => {
    expect(shortestAngle(179, -179)).toBe(2);
    expect(shortestAngle(-179, 179)).toBe(-2);
    expect(shortestAngle(10, 350)).toBe(-20);
  });
});

describe('validation', () => {
  it('accepts valid coordinates', () => {
    expect(validateLatLon(12.9716, 77.5846)).toEqual({ lat: 12.9716, lon: 77.5846 });
    expect(validateLatLon(-90, 180)).toBeTruthy();
  });

  it('rejects out-of-range coordinates', () => {
    expect(() => validateLatLon(91, 0)).toThrow(CoordinateError);
    expect(() => validateLatLon(0, 181)).toThrow(CoordinateError);
    expect(() => validateLatLon(Number.NaN, 0)).toThrow(CoordinateError);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(90.1)).toBe(false);
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude('10')).toBe(false);
  });

  it('parses "lat, lon" strings', () => {
    expect(parseCoordinates('12.9716, 77.5846')).toEqual({ lat: 12.9716, lon: 77.5846 });
    expect(parseCoordinates('12.9716 77.5846')).toEqual({ lat: 12.9716, lon: 77.5846 });
    expect(parseCoordinates('Seoul')).toBeNull();
    expect(() => parseCoordinates('95, 10')).toThrow(CoordinateError);
  });
});

describe('distance', () => {
  it('matches known great-circle distances', () => {
    const d = haversineKm({ lat: 28.6139, lon: 77.209 }, { lat: 19.076, lon: 72.8777 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1200);
  });
});

describe('antimeridian-safe outlines', () => {
  it('splits rings that jump the dateline', () => {
    const segments = splitAntimeridian([
      [170, 10],
      [179, 10],
      [-179, 10],
      [-170, 10],
    ]);
    expect(segments).toHaveLength(2);
  });

  it('creates two separate bbox outlines when crossing', () => {
    const rings = bboxRings([-10, 170, 10, -170]);
    expect(rings).toHaveLength(2);
    expect(rings[0].some(([lon]) => lon === 180)).toBe(true);
    expect(rings[1].some(([lon]) => lon === -180)).toBe(true);
  });

  it('handles a regular bbox in one ring', () => {
    const rings = bboxRings([33, 124, 39, 130]);
    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual([124, 33]);
  });

  it('extracts polygon and multipolygon rings', () => {
    const poly = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]], is_exact: true, note: '' };
    expect(boundaryRings(poly)).toHaveLength(1);
    const multi = {
      type: 'MultiPolygon' as const,
      coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[10, 10], [11, 10], [11, 11], [10, 10]]]],
      is_exact: true,
      note: '',
    };
    expect(boundaryRings(multi)).toHaveLength(2);
    expect(flattenCoordinates(multi.coordinates)).toHaveLength(8);
  });
});

describe('camera framing', () => {
  it('is closer for small regions than for a continent', () => {
    expect(altitudeForSpan(0.5, 0.8)).toBeLessThanOrEqual(altitudeForSpan(3, 4));
    expect(altitudeForSpan(3, 4)).toBeLessThan(altitudeForSpan(20, 30));
    expect(altitudeForSpan(40, 100)).toBeGreaterThan(altitudeForSpan(40, 80));
    expect(altitudeForSpan(0, 0)).toBeGreaterThanOrEqual(300);
  });
});

describe('formatting', () => {
  it('renders hemisphere labels', () => {
    expect(formatLat(-12.5)).toBe('12.5000° S');
    expect(formatLon(77.5846)).toBe('77.5846° E');
  });
});
