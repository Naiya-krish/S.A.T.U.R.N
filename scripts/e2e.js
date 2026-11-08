/**
 * End-to-end UI action test: drives the whole console with hand-written
 * UIAction JSON from the browser console (window.saturn.uiActions).
 * usage: node e2e.js [baseUrl]
 */
const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://localhost:5173';

const ACTIONS = [
  ['navigate_globe', { lat: 37.5665, lon: 126.978, altitude_km: 1200 }],
  ['highlight_location', { name: 'Seoul', lat: 37.5665, lon: 126.978, bbox: [37.42, 126.73, 37.59, 127.18] }],
  ['set_layer_opacity', { value: 0.55 }],
  ['set_imagery_layer', { layer_id: 'MODIS_Terra_CorrectedReflectance_TrueColor' }],
  ['set_observation_date', { date: '2026-10-20' }],
  ['toggle_map_overlay', { overlay: 'fires' }],
  ['set_slider', { control_id: 'gain', value: 0.4 }],
  ['select_dropdown', { control_id: 'projection', value: 'EPSG:3857' }],
  ['select_region_card', { index: 0 }],
  ['start_timeline_playback', { playing: false }],
  ['compare_dates', { mode: 'swipe' }],
  ['open_panel', { panel_id: 'layers' }],
  ['close_panel', { panel_id: 'layers' }],
  ['inspect_globe_state', {}],
  ['restore_global_view', {}],
  ['clear_all', {}],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1456, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5200);
  await page.evaluate(() => document.querySelector('[class*="loader"]')?.remove());

  const report = [];
  for (const [type, args] of ACTIONS) {
    const res = await page.evaluate(
      async ({ type, args }) => window.saturn.uiActions.debug(type, args),
      { type, args },
    );
    report.push(`${res.status.toUpperCase().padEnd(8)} ${type}${res.error ? ` :: ${res.error.slice(0, 90)}` : ''}`);
  }
  const invalid = await page.evaluate(() => window.saturn.uiActions.debug('navigate_globe', { lat: 999, lon: 0 }));
  report.push(`${invalid.status.toUpperCase().padEnd(8)} navigate_globe(invalid) :: ${String(invalid.error).slice(0, 70)}`);
  const cancelled = await page.evaluate(() => window.saturn.uiActions.execute({ action_id: 'x', type: 'clear_all', args: {}, origin: 'agent' }));
  report.push(`human/agent ${cancelled.status} ${cancelled.type}`);
  const snap = await page.evaluate(() => window.saturn.uiActions.debug('inspect_globe_state', {}));
  console.log(report.join('\n'));
  console.log('STATE', JSON.stringify(snap.result).slice(0, 400));
  console.log('PAGE ERRORS', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
})();
