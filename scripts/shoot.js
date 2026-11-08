/**
 * Stateless screenshot helper (no global state).
 * usage: node shoot.js <url> <out.png> <width> <height> <waitMs> [actionsJson]
 */
const { chromium } = require('playwright');

(async () => {
  const [url, out, w, h, wait, actionsJson] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: Number(w), height: Number(h) },
    deviceScaleFactor: 1,
  });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
  const bootless = url.includes('noboot=1') ? url : `${url}${url.includes('?') ? '&' : '?'}noboot=1`;
  await page.goto(bootless, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => logs.push(`[goto] ${e.message}`));
  if (actionsJson) {
    const actions = JSON.parse(actionsJson);
    for (const a of actions) {
      await page.evaluate(a).catch((e) => logs.push(`[eval] ${e.message}`));
      await page.waitForTimeout(800);
    }
  }
  await page.waitForTimeout(Number(wait || 2500));
  await page.screenshot({ path: out });
  console.log(logs.slice(-40).join('\n'));
  await browser.close();
})();
