/* Optional admin panel browser smoke test. Requires Node.js 22+, a running
 * admin server (ADMIN_PASSWORD=admin-test node admin-server.js), and Chromium
 * exposing a local DevTools endpoint on port 9334 (a separate port from the
 * game smoke test). */
'use strict';
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const endpoint = process.env.CDP_URL || 'http://127.0.0.1:9334';
  const url = process.env.ADMIN_URL || 'http://127.0.0.1:8080/';
  const password = process.env.ADMIN_PASSWORD || 'admin-test';
  const tab = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl), pending = new Map(), errors = []; let seq = 0;
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const job = pending.get(message.id); pending.delete(message.id); message.error ? job.reject(message.error) : job.resolve(message.result); }
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const text = id => evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);

  try {
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1200, deviceScaleFactor: 1, mobile: false });
    await send('Network.clearBrowserCookies');
    await send('Page.reload'); await delay(600);

    // Login gate visible first.
    assert.equal(await evaluate('getComputedStyle(document.getElementById("login")).display'), 'grid');
    // Wrong password rejected.
    await evaluate(`document.getElementById('login-password').value='nope'`);
    await click('#login-submit'); await delay(300);
    assert.match(await text('login-error'), /密码错误|登录/);
    // Correct password.
    await evaluate(`document.getElementById('login-password').value=${JSON.stringify(password)}`);
    await click('#login-submit'); await delay(600);
    assert.equal(await evaluate('getComputedStyle(document.getElementById("login")).display'), 'none');
    assert.notEqual(await evaluate('getComputedStyle(document.getElementById("panel")).display'), 'none');

    // Level list rendered (>= 6 built-in levels).
    const navCount = await evaluate('document.querySelectorAll("#level-nav .level-row").length');
    assert.ok(navCount >= 6);
    // Editor populated for first level.
    assert.ok((await text('editor-title')).length > 0);
    assert.ok(await evaluate('document.querySelectorAll("#route-list .route-card").length') > 0);

    // Compact workbench: side-by-side on desktop, map first on narrow screens.
    assert.equal(await evaluate('document.getElementById("basics-section").open'), false);
    for (const width of [1440, 1024, 768, 390, 320]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await delay(150);
      const layout = await evaluate(`(() => {
        const settings = document.querySelector('.settings-column').getBoundingClientRect();
        const map = document.querySelector('.map-section').getBoundingClientRect();
        const canvas = document.getElementById('map');
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          beside: map.left >= settings.right, above: map.bottom <= settings.top,
          canvasWidth: canvas.width, visibleWidth: canvas.getBoundingClientRect().width };
      })()`);
      assert.equal(layout.overflow, false, 'no horizontal overflow at ' + width);
      assert.ok(width >= 1200 ? layout.beside : layout.above, 'workbench placement at ' + width);
      assert.ok(layout.canvasWidth > 0 && Math.abs(layout.canvasWidth - layout.visibleWidth) <= 1);
      await evaluate('document.getElementById("basics-section").open = true');
      assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false);
      await evaluate('document.getElementById("basics-section").open = false');
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1200, deviceScaleFactor: 1, mobile: false });

    // Switch tools and ensure no exception.
    await click('.toolbar [data-tool="tree"]');
    await click('.toolbar [data-tool="water"]');

    // Create a new level and confirm editor follows.
    await click('#new-level'); await delay(200);
    const after = await evaluate('document.querySelectorAll("#level-nav .level-row").length');
    assert.equal(after, navCount + 1);

    // No unexpected runtime/console errors (favicon 404 and the intentional
    // wrong-password 401 are expected and harmless).
    const unexpected = errors.filter(e => !((e.url || '').endsWith('favicon.ico') || (e.url || '').endsWith('/api/login')));
    assert.deepEqual(unexpected, []);
    console.log('admin panel smoke test passed; levels =', after);
  } finally {
    try { await send('Page.close'); } catch { /* ignore */ }
    ws.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
