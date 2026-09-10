'use strict';
// Optional map-first UI checks: Node.js 22+, game server and local CDP browser.
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const endpoint = process.env.CDP_URL || 'http://127.0.0.1:9333';
  const url = process.env.GAME_URL || 'http://127.0.0.1:8180';
  const tab = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl), pending = new Map(), errors = [];
  let seq = 0;
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const job = pending.get(message.id); pending.delete(message.id);
      message.error ? job.reject(message.error) : job.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  // Real pointer clicks ensure collapsed controls cannot be activated invisibly.
  const click = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    await delay(80);
    const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await delay(80);
  };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.reload'); await delay(700);
    assert.equal(await evaluate('document.querySelector("#level-picker").open'), false);
    assert.equal(await evaluate('document.querySelector(".design-menu").open'), false);
    for (const width of [320, 390, 760, 768, 1024, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: width < 761 ? 2 : 1, mobile: width < 761 });
      await delay(150);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `overflow at ${width}px`);
      await click('#level-picker > summary');
      assert.equal(await evaluate('document.querySelector("#level-picker").open'), true);
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `expanded catalog overflow at ${width}px`);
      await click('.level-card.selected');
      assert.equal(await evaluate('document.querySelector("#level-picker").open'), false);
      await click('[data-mobile-panel="demand"]');
      assert.equal(await evaluate('document.querySelector("[data-mobile-panel=demand]").getAttribute("aria-pressed")'), 'true');
      assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-info-panel=demand]")).display'), 'block');
      assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-info-panel=mission]")).display'), 'none');
      await click('[data-mobile-panel="mission"]');
      await click('.design-menu > summary');
      assert.equal(await evaluate('document.querySelector(".design-menu").open'), true);
      await click('#save-design');
      await click('#load-design');
      assert.equal(await evaluate('document.querySelector("#load-dialog").open'), true);
      await click('#cancel-load');
      await click('.design-menu > summary');
      if (width <= 760) assert.equal(await evaluate('Array.from(document.querySelectorAll(".toolbar button, .zoom-controls button")).filter(button=>button.getClientRects().length).every(button=>button.getBoundingClientRect().height>=44)'), true, `touch targets at ${width}px`);
      await evaluate('window.scrollTo(0,0)');
      assert.equal(await evaluate('document.querySelector("canvas").getBoundingClientRect().top < 400'), true, `map must appear near the top at ${width}px`);
      assert.equal(await evaluate('document.querySelector(".toolbar").getBoundingClientRect().bottom <= document.querySelector(".canvas-wrap").getBoundingClientRect().top'), true, `toolbar must stay above the map at ${width}px`);
      if (width > 760) {
        assert.equal(await evaluate('document.querySelector("#start").getBoundingClientRect().bottom <= innerHeight'), true, `operation button must fit the desktop viewport at ${width}px`);
        assert.equal(await evaluate('document.querySelector(".canvas-wrap").getBoundingClientRect().width / document.querySelector(".board-panel").getBoundingClientRect().width > .9'), true, `map must use the desktop workspace width at ${width}px`);
      }
      assert.equal(await evaluate('Array.from(document.querySelectorAll("[hidden]")).every(element=>getComputedStyle(element).display==="none")'), true);
    }
    assert.deepEqual(errors, []);
    console.log('UI smoke passed: six viewport sizes, catalog, information panels, save/load, touch targets and map priority.');
  } finally {
    await fetch(`${endpoint}/json/close/${tab.id}`); ws.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
