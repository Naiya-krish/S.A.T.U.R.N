// Diagnoses a hanging page: reports errors and whether the main thread responds.
// usage: node scripts/diag.js [url]
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2] || 'http://localhost:5173/?noboot=1';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1456, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push('CONSOLE: ' + m.text().slice(0, 300)));
  page.on('requestfailed', (r) => errs.push('REQFAIL: ' + r.url().slice(0, 100)));
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch((e) => errs.push('GOTO: ' + e.message));
  await page.waitForTimeout(4000);
  const alive = await Promise.race([
    page.evaluate(() => 'RESPONSIVE'),
    new Promise((r) => setTimeout(() => r('MAIN THREAD BLOCKED'), 4000)),
  ]);
  console.log('main thread:', alive);
  console.log('errors:\n' + (errs.slice(0, 12).join('\n') || '  (none)'));
  await browser.close();
})();
