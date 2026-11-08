/**
 * Firestore rules tests — per-user isolation, run against the emulator.
 *
 *   npm install --no-save @firebase/rules-unit-testing firebase-tools
 *   firebase emulators:exec --only firestore "npx vitest run firestore-rules"
 *
 * If the emulator is not running these tests SKIP rather than fail, so the
 * normal offline test run stays green and the skip is visible in the output.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(join(here, '..', 'firestore.rules'), 'utf8');

const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '';
const HAS_EMULATOR = Boolean(EMULATOR);

let testEnv: any = null;
let policy: any = null;

async function loadToolkit() {
  try {
    return await import('@firebase/rules-unit-testing');
  } catch {
    return null;
  }
}

beforeAll(async () => {
  if (!HAS_EMULATOR) return;
  const toolkit = await loadToolkit();
  if (!toolkit) return;
  policy = toolkit;
  testEnv = await toolkit.initializeTestEnvironment({
    projectId: 'saturn-rules-test',
    firestore: { rules: RULES, host: EMULATOR.split(':')[0], port: Number(EMULATOR.split(':')[1] || 8080) },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

const uidPath = (uid: string, kind: string, id = 'doc1') => `saturn/users/${uid}/${kind}/${id}`;

const region = { name: 'South Korea', lat: 36.5, lon: 127.8 };

describe.skipIf(!HAS_EMULATOR)('firestore rules: per-user isolation', () => {
  it('a signed-in user can write and read their own region', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await policy.assertSucceeds(db.doc(uidPath('alice', 'regions')).set(region));
    await policy.assertSucceeds(db.doc(uidPath('alice', 'regions')).get());
  });

  it('a user cannot read another user\'s region', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await policy.assertSucceeds(alice.doc(uidPath('alice', 'regions')).set(region));

    const bob = testEnv.authenticatedContext('bob').firestore();
    await policy.assertFails(bob.doc(uidPath('alice', 'regions')).get());
  });

  it('a user cannot write into another user\'s collection', async () => {
    const bob = testEnv.authenticatedContext('bob').firestore();
    await policy.assertFails(bob.doc(uidPath('alice', 'regions')).set(region));
  });

  it('an unauthenticated client is denied everywhere', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await policy.assertFails(db.doc(uidPath('alice', 'regions')).get());
    await policy.assertFails(db.doc(uidPath('alice', 'regions')).set(region));
  });

  it('unknown subcollections are denied', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await policy.assertFails(db.doc(uidPath('alice', 'secrets')).set({ x: 1 }));
  });

  it('invalid coordinates are rejected', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await policy.assertFails(
      db.doc(uidPath('alice', 'regions', 'bad')).set({ name: 'X', lat: 999, lon: 0 }),
    );
  });

  it('valid preferences pass, bad opacity fails', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await policy.assertSucceeds(db.doc(uidPath('alice', 'prefs', 'prefs')).set({ opacity: 0.5 }));
    await policy.assertFails(db.doc(uidPath('alice', 'prefs', 'prefs')).set({ opacity: 3 }));
  });

  it('the whole database is closed by default', async () => {
    const db = testEnv.authenticatedContext('alice').firestore();
    await policy.assertFails(db.doc('random/whatever').get());
    await policy.assertFails(db.doc('users/alice/regions/x').get());
  });
});
