/**
 * Agent end-to-end demo in a real browser: types a command into the S.A.T.U.R.N.
 * command bar, lets the backend agent drive the UI through UI actions, waits for
 * completion and screenshots the result. Optionally captures the SSE trace.
 *
 * usage: node agent-demo.js "Show South Korea and display the latest suitable satellite imagery"
 */
const { chromium } = require('playwright');

const BASE = process.env.SATURN_BASE || 'http://localhost:5173';
const command = process.argv[2] || 'Show South Korea and display the latest suitable satellite imagery';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1456, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?noboot=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // capture the task stream in parallel so we can print the action trace
  const sse = page.waitForResponse((r) => r.url().includes('/events') && r.status() === 200).catch(() => null);

  const input = page.locator('input[aria-label="Command input"]').first();
  await input.fill(command);
  await input.press('Enter');

  const t0 = Date.now();
  let stage = 'idle';
  while (Date.now() - t0 < 150000) {
    stage = await page.evaluate(() => window.saturn.store.getState().agent.stage);
    if (stage === 'idle' && Date.now() - t0 > 4000) break;
    await page.waitForTimeout(750);
  }
  await page.waitForTimeout(2500);
  void sse;

  const snap = await page.evaluate(async () => {
    const r = await window.saturn.uiActions.debug('inspect_globe_state', {});
    const s = window.saturn.store.getState();
    return {
      state: r.result,
      messages: s.messages.map((m) => `${m.role}: ${m.text}`).slice(-6),
      trace: s.agent.trace.map((t) => `${t.type} ${t.status}${t.error ? ' :: ' + t.error : ''}`),
      error: s.agent.error,
    };
  });
  console.log(JSON.stringify(snap, null, 1));
  console.log('PAGE ERRORS', errors.length ? errors.join(' | ') : 'none');
  await page.screenshot({ path: process.env.SATURN_SHOT || 'docs/reference/agent-run.png' });
  await browser.close();
})();
