// Region diff: node scripts/diff.js <ref.png> <cur.png>
// Reports mean abs channel error over the central globe area and the whole frame.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const [a, b] = process.argv.slice(2);
  const url = (f) => 'file:///' + path.resolve(f).replace(/\\/g, '/');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1456, height: 720 } });
  const res = await page.evaluate(
    async ([ua, ub]) => {
      const load = (u) =>
        new Promise((r) => {
          const i = new Image();
          i.onload = () => r(i);
          i.src = u;
        });
      const [ia, ib] = await Promise.all([load(ua), load(ub)]);
      const get = (img) => {
        const c = document.createElement('canvas');
        c.width = 1456;
        c.height = 720;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, 1456, 720);
        return g.getImageData(0, 0, 1456, 720).data;
      };
      const da = get(ia);
      const db = get(ib);
      const regions = {
        globe: [480, 120, 980, 600],
        leftCol: [0, 0, 250, 600],
        rightCol: [1050, 0, 1250, 600],
        farRight: [1250, 0, 1456, 720],
        readout: [290, 560, 1040, 720],
        backdrop: [250, 0, 480, 720],
      };
      const out = {};
      for (const [name, [x0, y0, x1, y1]] of Object.entries(regions)) {
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y += 3) {
          for (let x = x0; x < x1; x += 3) {
            const i = (y * 1456 + x) * 4;
            sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
            n += 3;
          }
        }
        out[name] = +(sum / n).toFixed(1);
      }
      return out;
    },
    [url(a), url(b)],
  );
  console.log('mean abs channel error (0-255, lower = closer):');
  for (const [k, v] of Object.entries(res)) console.log(`  ${k.padEnd(10)} ${v}`);
  await browser.close();
})();
