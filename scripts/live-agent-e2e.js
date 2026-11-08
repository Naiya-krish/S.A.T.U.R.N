/**
 * Live Vertex AI end-to-end check.
 *
 * Opens the real UI, sends a command through the same API the app uses, and
 * waits for the task to settle — proving the full loop: model -> tools -> UI
 * actions -> browser ACKs -> evidence-based reply.
 *
 * usage: node live-agent-e2e.js "Show South Korea and display the latest satellite imagery"
 */
const { chromium } = require('playwright');

const TEXT = process.argv[2] || 'Show South Korea and display the latest suitable satellite imagery';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1456, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto('http://127.0.0.1:5173/?noboot=1', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForFunction(() => !!window.saturn?.uiActions, null, { timeout: 20000 });
  await page.waitForTimeout(1500);

  // Send through the app's own agent bridge so the SSE stream and ACK path are live.
  const taskId = await page.evaluate(async (text) => {
    const r = await fetch('/api/agent/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const j = await r.json();
    // Make sure the page is listening for this task's actions.
    window.saturn.store.getState().setAgentTask?.(j.task_id);
    return j.task_id;
  }, TEXT);
  console.log('task:', taskId);

  // The UI's own SSE hook drives actions; poll the task until it settles.
  const deadline = Date.now() + 180000;
  let last = null;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    const t = await page.evaluate(async (id) => {
      const r = await fetch(`/api/tasks/${id}`);
      return r.json();
    }, taskId);
    last = t;
    const nAck = (t.actions || []).filter((a) => a.status === 'executed').length;
    console.log(`  status=${t.status} actions=${(t.actions || []).length} acked=${nAck}`);
    if (['completed', 'failed', 'cancelled'].includes(t.status)) break;
  }

  console.log('\n--- final ---');
  console.log('status :', last?.status);
  console.log('reply  :', (last?.reply || '').slice(0, 400));
  console.log('error  :', last?.error || 'none');
  const acts = (last?.actions || []).map((a) => `${a.type}:${a.status}`);
  console.log('actions:', acts.join(', ') || 'none');

  const snap = await page.evaluate(() => window.saturn.globe.snapshot());
  console.log('globe  :', JSON.stringify({
    tilesLoaded: snap.tilesLoaded,
    tilesFailed: snap.tilesFailed,
    imageryLoaded: snap.imageryLoaded,
  }));
  console.log('errors :', errs.length ? errs.slice(0, 3) : 'none');

  await page.screenshot({ path: '../docs/reference/live-agent.png' });
  await browser.close();
  process.exit(last?.status === 'completed' ? 0 : 1);
})();
