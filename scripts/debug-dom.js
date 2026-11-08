/** Dumps computed styles for HUD elements to find why text/icons are dim. */
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1456, height: 720 } });
  p.on('console', (m) => console.log('console:', m.type(), m.text().slice(0, 200)));
  p.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 300)));
  await p.goto('http://localhost:5173');
  await p.waitForTimeout(5000);
  const r = await p.evaluate(() => {
    const pick = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return `${sel}: missing`;
      const cs = getComputedStyle(e);
      const rect = e.getBoundingClientRect();
      return `${sel}: color=${cs.color} opacity=${cs.opacity} font=${cs.fontFamily.split(',')[0]} fs=${cs.fontSize} rect=${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)}x${Math.round(rect.height)} text=${(e.textContent || '').slice(0, 30)}`;
    };
    const all = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.textContent || '').trim().length > 2);
    const colors = new Map();
    for (const e of all) {
      const c = getComputedStyle(e).color;
      colors.set(c, (colors.get(c) || 0) + 1);
    }
    const root = getComputedStyle(document.documentElement);
    return {
      scale: root.getPropertyValue('--scale'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      textColors: [...colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      clock: pick('[aria-label="System clock"]'),
      title: pick('[aria-label^="S.A.T.U.R.N."]'),
      stage: pick('[class*="stage"]'),
      viewport: pick('[class*="viewport"]'),
      panels: document.querySelectorAll('.panel').length,
      canvases: document.querySelectorAll('canvas').length,
      loader: !!document.querySelector('[class*="loader"]'),
      leafCount: all.length,
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
