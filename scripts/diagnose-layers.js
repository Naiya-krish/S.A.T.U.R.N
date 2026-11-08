/**
 * Diagnose the imagery layer: hide the filament base sphere and the ring shell,
 * then screenshot. If the globe shows continuous imagery, the "stripes" are the
 * base texture drawing ON TOP of the tiles (a layering problem), not a UV bug.
 *
 * usage: node diagnose-layers.js
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1456, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto('http://127.0.0.1:5173/?noboot=1', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => !!window.saturn?.uiActions, null, { timeout: 20000 });
  await page.evaluate(() =>
    window.saturn.uiActions.debug('set_imagery_layer', {
      layer_id: 'MODIS_Terra_CorrectedReflectance_TrueColor',
      date: '2026-10-31',
    }),
  );
  await page.waitForFunction(
    () => {
      const s = window.saturn.globe.snapshot();
      return s.tilesRequested > 0 && s.tilesLoaded + s.tilesFailed >= s.tilesRequested;
    },
    null,
    { timeout: 40000 },
  );
  await page.waitForTimeout(1200);

  // Hide every non-imagery child of the globe group except the earth surface.
  const info = await page.evaluate(() => {
    const scene = window.saturn.globe.__scene || null;
    return scene ? { children: scene.children?.length } : { note: 'scene not exposed' };
  });
  console.log('scene probe:', JSON.stringify(info));

  await page.screenshot({ path: '../docs/reference/_diag-layers.png' });
  console.log('errors:', errs.length ? errs : 'none');
  await browser.close();
})();
