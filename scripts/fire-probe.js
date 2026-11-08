/**
 * Runtime probe: are fire sprites actually in the scene graph, and where do they
 * project on screen? Diagnoses "detections in store but nothing visible".
 *
 * usage: node fire-probe.js
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1456, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto('http://127.0.0.1:5173/?noboot=1', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => !!window.saturn?.uiActions, null, { timeout: 20000 });
  await page.waitForTimeout(1000);

  await page.evaluate(async () => {
    await window.saturn.uiActions.debug('navigate_globe', { lat: 40, lon: 22, altitude_km: 6000 });
  });
  await page.waitForTimeout(2600);
  await page.evaluate(async () => {
    await window.saturn.uiActions.debug('show_fire_observations', {
      detections: [
        { lat: 39.5, lon: 22.3, confidence: 'h' },
        { lat: 41.2, lon: 20.1, confidence: 'h' },
      ],
      region: 'probe',
    });
  });
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const ctl = window.saturn.globe;
    return ctl.debugScene();
    // Walk whatever we can reach to find a group containing Sprites.
    
    if (scene) {
      for (const child of scene.children) {
        report.groups.push({
          type: child.type,
          children: child.children?.length ?? 0,
          visible: child.visible,
        });
      }
    }
    return report;
  });

  console.log(JSON.stringify(info, null, 2));
  console.log('errors:', errs.length ? errs.slice(0, 3) : 'none');
  await page.screenshot({ path: '../docs/reference/fire-probe.png' });
  await browser.close();
})();
