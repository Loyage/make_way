'use strict';
// Optional map-first UI checks: Node.js 22+, game server and local CDP browser.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function inspectPng(base64) {
  const file=Buffer.from(base64,'base64');
  assert.ok(file.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'screenshot must be PNG');
  const width=file.readUInt32BE(16),height=file.readUInt32BE(20),bitDepth=file[24],colorType=file[25],interlace=file[28],parts=[];
  for(let offset=8;offset<file.length;){const length=file.readUInt32BE(offset),type=file.subarray(offset+4,offset+8).toString();if(type==='IDAT')parts.push(file.subarray(offset+8,offset+8+length));offset+=length+12;}
  assert.equal(bitDepth,8);assert.equal(interlace,0);assert.ok([2,6].includes(colorType),`unsupported screenshot color type ${colorType}`);
  const channels=colorType===6?4:3,stride=width*channels,raw=zlib.inflateSync(Buffer.concat(parts)),colors=new Set();let previous=Buffer.alloc(stride),nonLight=0,samples=0;
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0,offset=0;y<height;y++){
    const filter=raw[offset++],row=Buffer.allocUnsafe(stride);assert.ok(filter<=4,`unsupported PNG filter ${filter}`);
    for(let x=0;x<stride;x++){
      const value=raw[offset++],left=x>=channels?row[x-channels]:0,up=previous[x],upperLeft=x>=channels?previous[x-channels]:0;
      row[x]=(value+(filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):filter===4?paeth(left,up,upperLeft):NaN))&255;
    }
    if(y%8===0)for(let x=0;x<width;x+=8){const at=x*channels,r=row[at],g=row[at+1],b=row[at+2];colors.add(`${r>>4}:${g>>4}:${b>>4}`);if(r+g+b<735)nonLight++;samples++;}
    previous=row;
  }
  return {width,height,bytes:file.length,colors:colors.size,nonLightRatio:nonLight/samples};
}

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
    const profiles=[{width:320,dpr:2,mobile:true},{width:390,dpr:2,mobile:true},{width:760,dpr:2,mobile:true},{width:768,dpr:1,mobile:false},{width:1024,dpr:1,mobile:false},{width:1440,dpr:2,mobile:false}];
    for (const {width,dpr,mobile} of profiles) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor:dpr, mobile });
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
      await evaluate('window.scrollTo(0,0)');await delay(100);
      const mapPosition=await evaluate('({top:document.querySelector("canvas").getBoundingClientRect().top,height:innerHeight})');
      assert.ok(mapPosition.top<mapPosition.height*.55,`map must appear in the upper viewport at ${width}px (actual ${mapPosition.top})`);
      assert.equal(await evaluate('document.querySelector(".toolbar").getBoundingClientRect().bottom <= document.querySelector(".canvas-wrap").getBoundingClientRect().top'), true, `toolbar must stay above the map at ${width}px`);
      if (width > 760) {
        assert.equal(await evaluate('document.querySelector("#start").getBoundingClientRect().bottom <= innerHeight'), true, `operation button must fit the desktop viewport at ${width}px`);
        assert.equal(await evaluate('document.querySelector(".canvas-wrap").getBoundingClientRect().width / document.querySelector(".board-panel").getBoundingClientRect().width > .9'), true, `map must use the desktop workspace width at ${width}px`);
      }
      assert.equal(await evaluate('Array.from(document.querySelectorAll("[hidden]")).every(element=>getComputedStyle(element).display==="none")'), true);
      const canvasScale=await evaluate('(()=>{const canvas=document.querySelector("canvas"),rect=canvas.getBoundingClientRect();return {x:canvas.width/rect.width,y:canvas.height/rect.height};})()');
      assert.ok(Math.abs(canvasScale.x-dpr)<.02&&Math.abs(canvasScale.y-dpr)<.02,`canvas DPR at ${width}px @${dpr}x`);
      const screenshot=inspectPng((await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data);
      assert.deepEqual([screenshot.width,screenshot.height],[width*dpr,900*dpr],`screenshot dimensions at ${width}px @${dpr}x`);
      assert.ok(screenshot.bytes>width*900*dpr*dpr/200,`screenshot has meaningful compressed content at ${width}px @${dpr}x`);
      assert.ok(screenshot.colors>40,`screenshot retains UI color detail at ${width}px @${dpr}x`);
      assert.ok(screenshot.nonLightRatio>.05&&screenshot.nonLightRatio<.95,`screenshot is neither blank nor fully obscured at ${width}px @${dpr}x`);
    }
    assert.deepEqual(errors, []);
    console.log('UI smoke passed: six viewport screenshots, mobile and desktop high DPR, catalog, information panels, save/load, touch targets and map priority.');
  } finally {
    await fetch(`${endpoint}/json/close/${tab.id}`); ws.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
