// Radial scan: node scripts/scan.js <image> <cx> <cy> <angleDeg> <r0> <r1> <step>
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const [file, cx, cy, ang, r0, r1, step] = process.argv.slice(2);
  const abs = 'file:///' + path.resolve(file).replace(/\\/g, '/');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(abs);
  const rows = await page.evaluate(
    ([cx, cy, ang, r0, r1, step]) => {
      const img = document.querySelector('img');
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const a = (ang * Math.PI) / 180;
      const out = [];
      for (let r = r0; r <= r1; r += step) {
        const x = Math.round(cx + Math.cos(a) * r);
        const y = Math.round(cy + Math.sin(a) * r);
        const d = g.getImageData(x, y, 1, 1).data;
        out.push(`${r}\t${x},${y}\t${d[0]},${d[1]},${d[2]}\tG=${d[1]}`);
      }
      return out;
    },
    [Number(cx), Number(cy), Number(ang), Number(r0), Number(r1), Number(step)],
  );
  console.log(rows.join('\n'));
  await browser.close();
})();
