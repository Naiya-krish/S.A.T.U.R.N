// Screenshot helper that analyses pixel geometry of the globe + panels.
// usage: node scripts/probe2.js <url> <out.png> <w> <h> <waitMs>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [, , url, out, w, h, wait] = process.argv;
(async () => {
  const dir = path.join(__dirname, '..', 'docs', 'reference', '.pw');
  fs.mkdirSync(dir, { recursive: true });
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    viewport: { width: Number(w), height: Number(h) },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(Number(wait || 2500));
  await page.screenshot({ path: out });
  const geo = await page.evaluate(() => {
    const q = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const canvas = document.querySelector('canvas');
    const cr = canvas ? canvas.getBoundingClientRect() : null;
    return {
      canvas: cr ? { x: cr.x, y: cr.y, w: cr.width, h: cr.height } : null,
      stage: q('[class*="stage"]'),
      viewport: q('[class*="viewport"]'),
    };
  });
  // Globe disc scan: find the horizontal extent of green pixels on the vertical centre.
  const buf = fs.readFileSync(out);
  console.log(JSON.stringify({ geo, errors, bytes: buf.length }, null, 2));
  await ctx.close();
})();
