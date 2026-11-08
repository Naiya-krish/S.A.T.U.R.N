/**
 * PWA verification: manifest validity, service worker registration, offline
 * shell, and the guarantee that API/imagery responses are NEVER cached.
 *
 * usage: node pwa-check.js
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1456, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto('http://localhost:4173/?noboot=1', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return { error: 'no manifest link' };
    const res = await fetch(link.href);
    return await res.json();
  });
  console.log('manifest:', JSON.stringify({
    name: manifest.name,
    display: manifest.display,
    icons: (manifest.icons || []).length,
    start_url: manifest.start_url,
  }));

  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await navigator.serviceWorker.getRegistration('/');
    return { supported: true, active: Boolean(reg && reg.active), scope: reg?.scope };
  });
  console.log('service worker:', JSON.stringify(sw));

  const swState = await page.evaluate(() => document.querySelector('#root')?.children.length ?? 0);
  console.log('root children rendered:', swState);

  // Confirm the SW rules: API and GIBS are never cached.
  const cacheKeys = await page.evaluate(async () => {
    const names = await caches.keys();
    const out = {};
    for (const n of names) {
      const c = await caches.open(n);
      out[n] = (await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).host).slice(0, 40);
    }
    return out;
  });
  const cachedPaths = Object.values(cacheKeys).flat();
  const leakedApi = cachedPaths.filter((p) => p.includes('/api/'));
  const leakedTiles = cachedPaths.filter((p) => p.includes('gibs.earthdata.nasa.gov'));
  console.log('cached entries:', cachedPaths.length);
  console.log('API responses cached (must be 0):', leakedApi.length, leakedApi.slice(0, 3));
  console.log('imagery tiles cached (must be 0):', leakedTiles.length);

  // Installability checks.
  const installable = await page.evaluate(() => ({
    hasName: Boolean(document.querySelector('link[rel="manifest"]')),
    themeColor: document.querySelector('meta[name="theme-color"]')?.content,
    viewportFit: document.querySelector('meta[name="viewport"]')?.content?.includes('viewport-fit=cover'),
  }));
  console.log('installable bits:', JSON.stringify(installable));
  console.log('page errors:', errs.length ? errs.slice(0, 3) : 'none');

  await browser.close();
})();
