// Finds panel border rows/columns by scanning for bright green 1px lines,
// so panel geometry is measured from the image instead of guessed.
// node scripts/panels.js <image> <x0> <x1> <y0> <y1>
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const [file, x0, x1, y0, y1] = process.argv.slice(2).map((v, i) => (i ? Number(v) : v));
  const abs = 'file:///' + path.resolve(file).replace(/\\/g, '/');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(abs);
  const rows = await page.evaluate(
    ([x0, x1, y0, y1]) => {
      const img = document.querySelector('img');
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const out = [];
      for (let y = y0; y <= y1; y++) {
        let hits = 0;
        for (let x = x0; x <= x1; x++) {
          const d = g.getImageData(x, y, 1, 1).data;
          if (d[1] > 70 && d[1] > d[0] * 1.6) hits++;
        }
        const frac = hits / (x1 - x0 + 1);
        if (frac > 0.6) out.push(`y=${y}  line  ${(frac * 100).toFixed(0)}%`);
      }
      // vertical borders over the same band
      for (let x = x0; x <= x1; x++) {
        let hits = 0;
        for (let y = y0; y <= y1; y++) {
          const d = g.getImageData(x, y, 1, 1).data;
          if (d[1] > 70 && d[1] > d[0] * 1.6) hits++;
        }
        const frac = hits / (y1 - y0 + 1);
        if (frac > 0.55) out.push(`x=${x}  col   ${(frac * 100).toFixed(0)}%`);
      }
      return out;
    },
    [x0, x1, y0, y1],
  );
  console.log(rows.join('\n'));
  await browser.close();
})();
