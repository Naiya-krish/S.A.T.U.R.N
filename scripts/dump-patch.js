/**
 * Dumps the imagery patch texture the globe actually built, so we can see what
 * is being drawn instead of guessing from the final render.
 *
 * usage: node dump-patch.js
 */
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1456, height: 720 } });
  await page.goto('http://127.0.0.1:5173/?noboot=1', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => !!window.saturn?.uiActions, null, { timeout: 20000 });
  await page.evaluate(() =>
    window.saturn.uiActions.debug('set_imagery_layer', {
      layer_id: 'MODIS_Terra_CorrectedReflectance_TrueColor',
      date: '2026-10-31',
    }),
  );
  await page.waitForTimeout(9000);

  const dataUrl = await page.evaluate(() => {
    const c = window.__saturnPatch;
    return c ? c.toDataURL('image/png') : null;
  });

  if (dataUrl) {
    fs.writeFileSync('../docs/reference/_globe-canvas.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('wrote _globe-canvas.png');
  } else {
    console.log('no canvas found');
  }

  const info = await page.evaluate(() => {
    const snap = window.saturn.globe.snapshot();
    return snap;
  });
  console.log('snapshot:', JSON.stringify(info));
  await browser.close();
})();
