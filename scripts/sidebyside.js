// Side-by-side comparison: node scripts/sidebyside.js <ref.png> <cur.png> <out.png>
// Left = reference, right = current build, each labelled.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const [a, b, out] = process.argv.slice(2);
  const url = (f) => 'file:///' + path.resolve(f).replace(/\\/g, '/');
  const html = `<!doctype html><html><body style="margin:0;background:#000;font:11px monospace;color:#39ff88">
  <div style="display:flex">
    <figure style="margin:0;width:1456px">
      <figcaption style="height:22px;line-height:22px;padding-left:8px">REFERENCE — saturn-1456.png</figcaption>
      <img src="${url(a)}" width="1456" height="720" style="display:block">
    </figure>
    <figure style="margin:0;width:1456px">
      <figcaption style="height:22px;line-height:22px;padding-left:8px">CURRENT BUILD (1456×720)</figcaption>
      <img src="${url(b)}" width="1456" height="720" style="display:block">
    </figure>
  </div></body></html>`;
  const tmp = path.resolve('scripts/_sbs.html');
  fs.writeFileSync(tmp, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2912, height: 742 } });
  await page.goto('file:///' + tmp.replace(/\\/g, '/'));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  fs.unlinkSync(tmp);
  console.log('wrote', out);
})();
