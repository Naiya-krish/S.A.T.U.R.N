/**
 * Verify the fire overlay end to end: push detections through the SAME UI action
 * the agent emits, then confirm they reached the store and the globe.
 *
 * usage: node fire-check.js
 */
const { chromium } = require('playwright');

const DETECTIONS = [
  { lat: 39.5, lon: 22.3, confidence: 'h', satellite: 'N', acquired: '2026-11-02' },
  { lat: 38.1, lon: 23.7, confidence: 'n', satellite: 'N', acquired: '2026-11-02' },
  { lat: 41.2, lon: 20.1, confidence: 'l', satellite: 'N', acquired: '2026-11-02' },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1456, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto('http://127.0.0.1:5173/?noboot=1', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => !!window.saturn?.uiActions, null, { timeout: 20000 });
  await page.waitForTimeout(1200);

  // Put the detections in view: the default camera faces the Atlantic, so
  // Europe sits on the far side and the markers are correctly hidden by depth.
  await page.evaluate(async () => {
    await window.saturn.uiActions.debug('navigate_globe', { lat: 40, lon: 22, altitude_km: 6000 });
  });
  await page.waitForTimeout(2600);

  const result = await page.evaluate(async (dets) => {
    const out = await window.saturn.uiActions.debug('show_fire_observations', {
      detections: dets,
      region: 'Southern Europe',
    });
    const s = window.saturn.store.getState();
    return {
      result: out,
      firesInStore: s.fires.length,
      overlayOn: s.overlays.fires,
      firstLabel: s.fires[0]?.label,
      sample: s.fires.slice(0, 3).map((f) => [f.lat, f.lon, f.confidence]),
    };
  }, DETECTIONS);

  console.log('action result :', JSON.stringify(result.result).slice(0, 160));
  console.log('fires in store:', result.firesInStore);
  console.log('overlay on    :', result.overlayOn);
  console.log('label         :', result.firstLabel);
  console.log('sample        :', JSON.stringify(result.sample));
  console.log('errors        :', errs.length ? errs.slice(0, 3) : 'none');

  await page.screenshot({ path: '../docs/reference/fire-overlay.png' });
  await browser.close();
  process.exit(result.firesInStore === DETECTIONS.length && result.overlayOn ? 0 : 1);
})();
