// Pixel probe: node scripts/probe.js <image> <x:y> [x:y ...]
// Prints RGB at each point, plus a horizontal scan for the globe limb.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const [file, ...pts] = process.argv.slice(2);
  const abs = 'file:///' + path.resolve(file).replace(/\\/g, '/');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(abs);
  const out = await page.evaluate(async (pts) => {
    const img = document.querySelector('img');
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const res = { w: c.width, h: c.height, pts: [] };
    for (const p of pts) {
      const [x, y] = p.split(':').map(Number);
      const d = g.getImageData(x, y, 1, 1).data;
      res.pts.push(`${p} = ${d[0]},${d[1]},${d[2]}`);
    }
    return res;
  }, pts);
  console.log(`${out.w}x${out.h}`);
  out.pts.forEach((p) => console.log(p));
  await browser.close();
})();
