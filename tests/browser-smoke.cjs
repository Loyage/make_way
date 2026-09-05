/* Optional integration test against a running Chrome DevTools endpoint.
 * Start Chromium with --headless --remote-debugging-port=9333 and run the game server.
 * Node.js 22+ supplies the WebSocket client; no packages are required.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const LEVELS = require('../levels.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const endpoint = process.env.CDP_URL || 'http://127.0.0.1:9333';
  const url = process.env.GAME_URL || 'http://127.0.0.1:8180';
  const tab = await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method:'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => {ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let seq=0;
  const pending=new Map(), errors=[];
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id){const job=pending.get(message.id);pending.delete(message.id);message.error?job.reject(message.error):job.resolve(message.result);}
    else if(message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    else if(message.method==='Log.entryAdded' && message.params.entry.source==='security' && message.params.entry.level==='error') errors.push(message.params.entry);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async expression=>{
    const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const text=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
  async function drag(x1,y1,x2,y2){
    const r=await evaluate('(()=>{const r=document.querySelector("canvas").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
    const mouse=(type,x,y)=>send('Input.dispatchMouseEvent',{type,x:r.x+(x+.5)*r.w/16,y:r.y+(y+.5)*r.h/12,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
    await mouse('mousePressed',x1,y1);await mouse('mouseMoved',x2,y2);await mouse('mouseReleased',x2,y2);
  }
  try {
    await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1200,deviceScaleFactor:1,mobile:false});
    // Reload after enabling exception/CSP logging, so startup failures are observable.
    await send('Page.reload');await delay(400);
    assert.equal(await evaluate('document.querySelectorAll(".level-card").length'),5);
    for(let i=0;i<LEVELS.length;i++){
      await click(`.level-card:nth-child(${i+1})`);
      assert.equal(await text('map-name'),LEVELS[i].name);
      assert.equal(await text('budget'),String(LEVELS[i].budget));
      assert.equal(await text('target-unit'),`/ ${LEVELS[i].target} 辆`);
      assert.equal(await evaluate('document.querySelectorAll(".connection-row").length'),LEVELS[i].routes.length);
      assert.equal(await evaluate('document.querySelectorAll(".level-card[aria-current=true]").length'),1);
    }
    await click('.level-card:nth-child(1)');
    await drag(3,3,10,3);assert.equal(await text('budget'),'28');
    await click('.level-card:nth-child(2)');assert.equal(await evaluate('document.querySelector("#level-dialog").open'),true);
    await click('#cancel-level');assert.equal(await text('map-name'),'晨光街区');assert.equal(await text('budget'),'28');
    await click('.level-card:nth-child(2)');await click('#confirm-level');assert.equal(await text('budget'),'64');
    // Check the original fast-drag path and dynamic route status.
    await drag(2,3,6,3);await drag(9,3,11,3);
    assert.equal(await text('connection-count'),'1 / 3');
    await click('#start');await delay(150);await click('.level-card:nth-child(3)');
    assert.equal(await text('phase-label'),'已暂停');await click('#cancel-level');
    await click('#reset');await click('#confirm-reset');assert.equal(await text('map-name'),'河畔新城');assert.equal(await text('budget'),'64');
    // Accelerate deterministic game time only in this test tab to inspect result UI.
    await evaluate(`(() => {
      const step=TrafficCore.City.prototype.step;
      TrafficCore.City.prototype.step=function(dt){window.testCity=this;for(let i=0;i<600;i++)step.call(this,dt);};
    })()`);
    await click('#start');await delay(350);
    assert.equal(await evaluate('window.testCity.state'),'lost');
    assert.equal(await evaluate('document.querySelector("#result-dialog").open'),true);
    assert.equal(await evaluate('document.querySelector("#next-level").hidden'),true);
    await click('#view-city');await click('.level-card:nth-child(1)');
    await drag(3,3,10,3);await drag(5,8,11,8);await click('#start');await delay(350);
    assert.equal(await evaluate('window.testCity.state'),'won');
    assert.equal(await evaluate('document.querySelector("#next-level").hidden'),false);
    await click('#next-level');assert.equal(await text('map-name'),'河畔新城');assert.equal(await text('phase-label'),'规划中');
    await click('.level-card:nth-child(5)');
    // Force final-level success to check navigation bounds; core tests check actual solvability.
    await evaluate('TrafficCore.City.prototype.step=function(){this.state="won";this.delivered=this.level.target;};');
    await click('#start');await delay(120);
    assert.equal(await evaluate('document.querySelector("#next-level").hidden'),true);
    await click('#play-again');assert.equal(await text('map-name'),'都会早高峰');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(100);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    assert.equal(await evaluate('[...document.querySelectorAll(".level-card")].every(el=>el.getBoundingClientRect().right<=innerWidth)'),true);
    await evaluate('document.querySelector("canvas").scrollIntoView({block:"center"})');await delay(100);
    const r=await evaluate('(()=>{const r=document.querySelector("canvas").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
    const touch=(type,x,y)=>send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:r.x+(x+.5)*r.w/16,y:r.y+(y+.5)*r.h/12}]});
    await touch('touchStart',3,2);await touch('touchMove',6,2);await touch('touchEnd');
    assert.equal(await text('budget'),'48');
    if(process.env.SCREENSHOT) {
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      fs.writeFileSync(process.env.SCREENSHOT,Buffer.from(shot.data,'base64'));
    }
    assert.deepEqual(errors,[]);
    console.log('Browser smoke passed: 5 levels, budget/targets, switching confirmation, pause/reset, win/loss/next-level, mobile layout and touch; no runtime or CSP errors.');
  } finally {
    await fetch(`${endpoint}/json/close/${tab.id}`).catch(()=>{});
    ws.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
