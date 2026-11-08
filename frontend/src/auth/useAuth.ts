/**
 * Optional Firebase Authentication (Phase 8).
 *
 * Deliberately lazy and optional:
 *   * The Firebase SDK is code-split, so the app boots and works without it.
 *   * If no Firebase web config is present the module reports `unavailable` and
 *     the UI shows a DEMO badge instead of a broken sign-in button.
 *   * The ID token is attached to API calls; nothing else leaves the browser.
 *
 * Web config values are PUBLIC by design (they identify the project, they do
 * not authorise anything). Secrets stay server-side.
 */

import { create } from 'zustand';

type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

type AuthState = {
  status: 'unknown' | 'unavailable' | 'signed-out' | 'signed-in';
  uid: string | null;
  email: string | null;
  mode: 'firebase' | 'demo' | 'unknown';
  storage: string | null;
  persistent: boolean;
  notice: string;
  token: string | null;
  busy: boolean;
  error: string | null;
  init: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshToken: () => Promise<string | null>;
};

function readConfig(): FirebaseConfig | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const cfg = {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
  };
  return cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId ? cfg : null;
}

/** Loaded lazily so the bundle is not required for the app to run. */
let authMod: typeof import('firebase/auth') | null = null;

async function loadSdk() {
  if (authMod) return authMod;
  const [auth, app] = await Promise.all([import('firebase/auth'), import('firebase/app')]);
  const cfg = readConfig()!;
  const appInstance = app.getApps().length ? app.getApp() : app.initializeApp(cfg);
  authMod = auth;
  // Keep the app instance reachable for the SDK's own bookkeeping.
  void appInstance;
  return auth;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'unknown',
  uid: null,
  email: null,
  mode: 'unknown',
  storage: null,
  persistent: false,
  notice: '',
  token: null,
  busy: false,
  error: null,

  init: async () => {
    // Ask the backend what mode it is in. This is the source of truth: a browser
    // may have Firebase config while the server runs without a project.
    let backendMode: 'firebase' | 'demo' | 'disabled' = 'demo';
    let storage: string | null = null;
    let persistent = false;
    let notice = '';
    try {
      const r = await fetch('/api/auth/config', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        backendMode = j.mode;
        storage = j.storage ?? null;
        persistent = Boolean(j.persistent);
        notice = j.notice ?? '';
      }
    } catch {
      /* backend unreachable; stay in demo presentation */
    }

    const cfg = readConfig();
    if (backendMode !== 'firebase' || !cfg) {
      set({
        status: 'unavailable',
        mode: backendMode === 'firebase' ? 'firebase' : 'demo',
        storage,
        persistent,
        notice,
      });
      return;
    }

    try {
      const auth = await loadSdk();
      const appMod = await import('firebase/app');
      const inst = appMod.getApps()[0];
      auth.onAuthStateChanged(auth.getAuth(inst), async (user) => {
        if (!user) {
          set({ status: 'signed-out', uid: null, email: null, token: null, mode: 'firebase' });
          return;
        }
        const token = await user.getIdToken();
        set({ status: 'signed-in', uid: user.uid, email: user.email, token, mode: 'firebase' });
      });
    } catch (e) {
      set({ status: 'unavailable', error: e instanceof Error ? e.message : String(e) });
    }
  },

  signIn: async () => {
    set({ busy: true, error: null });
    try {
      const auth = await loadSdk();
      const appMod = await import('firebase/app');
      const inst = appMod.getApps()[0];
      const provider = new auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await auth.signInWithPopup(auth.getAuth(inst), provider);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Popup blocked / cancelled is a normal user action, not a failure.
      set({ error: /popup|closed|cancel/i.test(msg) ? null : msg });
    } finally {
      set({ busy: false });
    }
  },

  signOut: async () => {
    set({ busy: true });
    try {
      const auth = await loadSdk();
      const appMod = await import('firebase/app');
      await auth.signOut(auth.getAuth(appMod.getApps()[0]));
      set({ status: 'signed-out', uid: null, email: null, token: null });
    } finally {
      set({ busy: false });
    }
  },

  refreshToken: async () => {
    const { status } = get();
    if (status !== 'signed-in') return null;
    try {
      const auth = await loadSdk();
      const appMod = await import('firebase/app');
      const user = auth.getAuth(appMod.getApps()[0]).currentUser;
      if (!user) return null;
      const token = await user.getIdToken();
      set({ token });
      return token;
    } catch {
      return null;
    }
  },
}));

/** Authorization headers for API calls (empty when signed out). */
export function authHeaders(): Record<string, string> {
  const token = useAuth.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
