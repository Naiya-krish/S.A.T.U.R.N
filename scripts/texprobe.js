// Renders the base globe texture in a browser and samples it, so texture
// problems are separated from sphere/shader problems.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 760 } });
  await page.goto('http://localhost:5173/?noboot=1', { waitUntil: 'networkidle' }).catch(() => { });
  await page.waitForTimeout(3000);
  const data = await page.evaluate(async () => {
    const mod = await import('/src/globe/textures.ts');
    const tex = mod.createBaseEarthTexture(1400, 700);
    const src = tex.image;
    const out = document.createElement('canvas');
    out.width = 1400;
    out.height = 700;
    out.getContext('2d').drawImage(src, 0, 0, 1400, 700);
    const g = out.getContext('2d');
    const samples = {
      oceanPacific: g.getImageData(150, 350, 1, 1).data,
      africa: g.getImageData(740, 380, 1, 1).data,
      asia: g.getImageData(980, 250, 1, 1).data,
      southAmerica: g.getImageData(480, 480, 1, 1).data,
      topRow: g.getImageData(700, 2, 1, 1).data,
    };
    return { url: out.toDataURL('image/png'), samples: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, [v[0], v[1], v[2]]])) };
  });
  require('fs').writeFileSync('scripts/texprobe.png', Buffer.from(data.url.split(',')[1], 'base64'));
  console.log(JSON.stringify(data.samples, null, 2));
  await browser.close();
})();
