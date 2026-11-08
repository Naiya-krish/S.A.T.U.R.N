// Two-image side-by-side: node scripts/cmp2.js <left.png> <right.png> <out.png> [labelL] [labelR]
// Images are inlined as data URIs so file:// pages render reliably.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const [l, r, out, ll = 'REFERENCE', lr = 'CURRENT'] = process.argv.slice(2);
  const data = (f) => 'data:image/png;base64,' + fs.readFileSync(path.resolve(f)).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1560, height: 660 } });
  await page.setContent(`<body style="margin:0;background:#000;display:flex;font:12px monospace;color:#39ff88">
    <div style="width:780px"><div style="padding:4px">${ll}</div>
      <img src="${data(l)}" style="width:780px;display:block"></div>
    <div style="width:780px"><div style="padding:4px">${lr}</div>
      <img src="${data(r)}" style="width:780px;display:block"></div>
  </body>`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log('wrote', out);
})();
