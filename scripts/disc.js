// Measures the globe disc: node scripts/disc.js <image> [threshold]
// Scans the centre row/column for the sphere's edge (bright limb against bg).
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const [file, thr] = process.argv.slice(2);
  const t = Number(thr || 26);
  const abs = 'file:///' + path.resolve(file).replace(/\\/g, '/');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(abs);
  const res = await page.evaluate(
    ([t]) => {
      const img = document.querySelector('img');
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const G = (x, y) => d[(y * c.width + x) * 4 + 1];
      const rows = [];
      let top = -1;
      let bot = -1;
      for (let y = 60; y < 620; y++) {
        let hits = 0;
        for (let x = 500; x < 960; x += 2) if (G(x, y) > t && G(x, y) > 2.2 * d[(y * c.width + x) * 4]) hits++;
        if (hits > 40) {
          if (top < 0) top = y;
          bot = y;
        }
      }
      const cy = Math.round((top + bot) / 2);
      let left = -1;
      let right = -1;
      for (let x = 400; x < 1060; x++) {
        if (G(x, cy) > t && G(x, cy) > 2.2 * d[(cy * c.width + x) * 4]) {
          if (left < 0) left = x;
          right = x;
        }
      }
      rows.push(`top=${top} bottom=${bot} centreY=${cy}`);
      rows.push(`left=${left} right=${right} centreX=${(left + right) / 2}`);
      rows.push(`radiusY=${(bot - top) / 2} radiusX=${(right - left) / 2}`);
      return rows;
    },
    [t],
  );
  console.log(res.join('\n'));
  await browser.close();
})();
