/**
 * Crop helper for visual QA.
 * usage: node crop.js <src.png> <out.png> <x> <y> <w> <h> [scale]
 */
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const [src, out, x, y, w, h, scale] = process.argv.slice(2);
  const s = Number(scale || 1);
  const PNG = require('pngjs').PNG;
  const img = PNG.sync.read(require('fs').readFileSync(path.resolve(src)));
  const W = Number(w) * s;
  const H = Number(h) * s;
  const dst = new PNG({ width: W, height: H });
  for (let j = 0; j < H; j++) {
    const sy = Math.min(img.height - 1, Math.round(Number(y) + j / s));
    for (let i = 0; i < W; i++) {
      const sx = Math.min(img.width - 1, Math.round(Number(x) + i / s));
      const si = (img.width * sy + sx) << 2;
      const di = (W * j + i) << 2;
      dst.data[di] = img.data[si];
      dst.data[di + 1] = img.data[si + 1];
      dst.data[di + 2] = img.data[si + 2];
      dst.data[di + 3] = 255;
    }
  }
  require('fs').writeFileSync(out, PNG.sync.write(dst));
  return;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(
    `<html><body style="margin:0">
      <img src="${abs}" style="position:absolute;left:${-Number(x) * s}px;top:${-Number(y) * s}px;width:${1456 * s}px;height:${720 * s}px">
     </body></html>`,
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: out });
  await browser.close();
})();
