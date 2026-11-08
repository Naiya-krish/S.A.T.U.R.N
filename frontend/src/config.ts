/** Global product constants + env-driven feature flags. */

export const PRODUCT = {
  name: 'S.A.T.U.R.N.',
  full: 'SENTIENT AGENTIC TERRAIN & UNIVERSE RECONNAISSANCE NETWORK',
  short: 'SENTIENT AGENTIC TERRAIN & UNIVERSE RECONNAISSANCE NETWORK',
  spaced: 'S.A.T.U.R.N.',
  version: 'v0.9.4',
  designation: 'ORBITAL EARTH-INTELLIGENCE COMMAND',
} as const;

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
export const ENABLE_LOADER: boolean = (import.meta.env.VITE_ENABLE_LOADER ?? '1') !== '0';
/** A freshly booted console is shown opaque immediately; the loader fades over it. */
export const BOOTED_KEY = 'saturn.booted';
export const WAKE_WORD_ENABLED: boolean = (import.meta.env.VITE_WAKE_WORD_ENABLED ?? '0') === '1';

/** Design canvas from the reference image; everything scales from this. */
export const DESIGN = { width: 1456, height: 720 } as const;

export const EARTH_RADIUS_KM = 6371.0088;
export const MIN_ALTITUDE_KM = 420;
export const MAX_ALTITUDE_KM = 34000;
export const DEFAULT_ALTITUDE_KM = 15500;

export const GIBS_ACK =
  'IMAGERY: NASA GLOBAL IMAGERY BROWSE SERVICES (GIBS) / EOSDIS — ACKNOWLEDGED';
