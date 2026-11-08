/**
 * Phase 5 / imagery acceptance check.
 * Loads one real GIBS layer, waits for tiles, and reports tile counts from the
 * live globe snapshot — the honest source of truth, not the UI label.
 *
 * usage: node imagery-check.js
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1456, height: 720 } });
  const errs = [];
  const fails = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('requestfailed', (r) => fails.push(`${r.url().slice(0, 90)} ${r.failure()?.errorText}`));

  await page.goto('http://127.0.0.1:5173/?noboot=1', { waitUntil: 'networkidle', timeout: 45000 });
  // The debug bridge is attached by a dynamic import after mount.
  await page.waitForFunction(() => !!window.saturn?.uiActions, null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  const res = await page.evaluate(async () => {
    const out = await window.saturn.uiActions.debug('set_imagery_layer', {
      layer_id: 'MODIS_Terra_CorrectedReflectance_TrueColor',
      date: '2026-10-31',
    });
    return out;
  });
  console.log('action result:', JSON.stringify(res).slice(0, 300));

  // Wait until every requested tile has settled (loaded OR failed). Reading the
  // counters at a fixed delay raced the downloads and looked like "stripes".
  await page.waitForFunction(
    () => {
      const s = window.saturn.globe.snapshot();
      return s.tilesRequested > 0 && s.tilesLoaded + s.tilesFailed >= s.tilesRequested;
    },
    null,
    { timeout: 40000 },
  );
  await page.waitForTimeout(1500);
  const snap = await page.evaluate(() => window.saturn.globe.snapshot());
  console.log('globe snapshot tiles:', JSON.stringify({
    requested: snap.tilesRequested,
    loaded: snap.tilesLoaded,
    failed: snap.tilesFailed,
    imageryLoaded: snap.imageryLoaded,
  }));

  await page.screenshot({ path: '../docs/reference/imagery-ok.png' });
  console.log('page errors:', errs.length ? errs.slice(0, 4) : 'none');
  console.log('failed requests:', fails.length ? fails.slice(0, 6) : 'none');
  await browser.close();
})();
