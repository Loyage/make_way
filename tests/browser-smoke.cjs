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
    await evaluate('localStorage.clear()');await send('Page.reload');await delay(400);
    assert.equal(await evaluate('document.querySelectorAll(".level-card").length'),5);
    assert.equal(await evaluate('document.querySelector("#load-design").disabled'),true);
    for(let i=0;i<LEVELS.length;i++){
      await click(`.level-card:nth-child(${i+1})`);
      assert.equal(await text('map-name'),LEVELS[i].name);
      assert.equal(await text('budget'),String(LEVELS[i].budget));
      assert.equal(await text('target-unit'),`/ ${LEVELS[i].target} 辆`);
      assert.equal(await evaluate('document.querySelectorAll(".connection-row").length'),LEVELS[i].routes.length);
      assert.equal(await evaluate('document.querySelectorAll(".level-card[aria-current=true]").length'),1);
    }
    await click('.level-card:nth-child(1)');
    const select = (id,value) => evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await drag(3,3,3,3);assert.equal(await text('budget'),'36','click alone must not construct');
    await drag(3,3,5,3);assert.equal(await text('budget'),'33');
    await select('road-grade','2');await drag(3,3,5,3);assert.equal(await text('budget'),'27');
    assert.ok((await text('grade-description')).includes('5.2'));
    await select('road-grade','1');await drag(3,3,5,3);assert.equal(await text('budget'),'30');
    await click('#inspect-tool');await drag(4,3,4,3);assert.equal(await text('budget'),'30');
    assert.ok((await text('road-detail')).includes('干道'));
    assert.ok((await text('road-load')).includes('2 车道 × 前后 2 辆'));
    assert.equal(await evaluate('document.querySelector("#signal-enabled").disabled'),true);
    await select('road-grade','0');await drag(4,3,4,4);await click('#inspect-tool');await drag(4,3,4,3);
    assert.equal(await evaluate('document.querySelector("#signal-enabled").disabled'),false);
    assert.equal(await evaluate('document.querySelector("#signal-enabled").checked'),false);
    assert.ok((await text('signal-phase')).includes('50%'));
    await click('#signal-enabled');
    // Observe actual Canvas paint: the T junction has only existing exits.
    await evaluate(`(() => {
      const original=TrafficCore.City.prototype.signalPhase;
      TrafficCore.City.prototype.signalPhase=function(n){window.paintCity=this;return original.call(this,n);};
      const ctx=document.querySelector('canvas').getContext('2d'),stroke=ctx.stroke;
      window.signalStrokes=[];
      ctx.stroke=function(...args){
        if(['#187b48','#c33f39','#f5f1d9'].includes(this.strokeStyle))window.signalStrokes.push(this.strokeStyle);
        return stroke.apply(this,args);
      };
      window.restoreSignalPaint=()=>{TrafficCore.City.prototype.signalPhase=original;ctx.stroke=stroke;};
    })()`);await delay(70);
    for(const [time,hasGreen] of [[0,true],[2.1,false],[2.3,true],[4.6,false],[6.9,true]]) {
      await evaluate(`window.paintCity.elapsed=${time};window.signalStrokes=[];`);await delay(60);
      assert.equal(await evaluate('window.signalStrokes.includes("#187b48")'),hasGreen,`arrow phase ${time}`);
      assert.equal(await evaluate('window.signalStrokes.includes("#c33f39")'),true);
      assert.equal(await evaluate('window.signalStrokes.includes("#f5f1d9")'),true);
      assert.equal(await evaluate('window.signalStrokes.length%6'),0,'T junction should paint six valid turning arrows per frame');
    }
    await click('#signal-enabled');await evaluate('window.signalStrokes=[]');await delay(60);
    assert.equal(await evaluate('window.signalStrokes.length>0 && window.signalStrokes.every(c=>c==="#f5f1d9")'),true);
    await click('#signal-enabled');await evaluate('window.paintCity.elapsed=0;window.restoreSignalPaint()');await delay(60);
    if(process.env.SIGNAL_SCREENSHOT) {
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      fs.writeFileSync(process.env.SIGNAL_SCREENSHOT,Buffer.from(shot.data,'base64'));
    }
    await select('signal-cycle','6');assert.ok((await text('signal-phase')).includes('6.0'));
    assert.ok((await text('signal-phase')).includes('横向直行绿灯'));
    assert.ok((await text('signal-phase')).includes('右转须让行'));
    await click('#signal-enabled');assert.ok((await text('signal-phase')).includes('自动避让'));
    await click('#erase-tool');await drag(4,4,4,4);await click('#inspect-tool');await drag(4,3,4,3);
    assert.equal(await evaluate('document.querySelector("#signal-enabled").disabled'),true);
    // Capture the actual city during rendering, without a production debug API.
    await evaluate(`(() => {
      const original=TrafficCore.City.prototype.roadType;
      TrafficCore.City.prototype.roadType=function(n){window.renderCity=this;return original.call(this,n);};
      window.restoreRoadType=()=>TrafficCore.City.prototype.roadType=original;
    })()`);await delay(60);
    await evaluate(`(() => {
      const city=window.renderCity;window.restoreRoadType();city.cars=[];
      for(let grade=0;grade<3;grade++) {
        const cell=TrafficCore.key(grade+3,3);city.edit(cell,false,grade);
        for(const slot of [0,1]) city.cars.push({id:grade*2+slot,route:0,cell,next:null,heading:1,cellHeading:1,lane:0,cellLane:0,cellSlot:slot,progress:0,blocked:2});
      }
      const ctx=document.querySelector('canvas').getContext('2d'),original=ctx.roundRect;
      window.carDimensions=[];
      ctx.roundRect=function(x,y,w,h,...rest){
        const scale=document.querySelector('canvas').getBoundingClientRect().width/16;
        if(Math.abs(w/scale-TrafficCore.VEHICLE_LENGTH)<.0001 && Math.abs(h/scale-TrafficCore.VEHICLE_WIDTH)<.0001) window.carDimensions.push([w/scale,h/scale]);
        return original.call(this,x,y,w,h,...rest);
      };
      window.restoreRect=()=>ctx.roundRect=original;
    })()`);await delay(80);
    assert.equal(await evaluate('window.carDimensions.length>=12'),true);
    assert.equal(await evaluate('new Set(window.carDimensions.map(v=>v.join(","))).size'),1);
    if(process.env.ROAD_SCREENSHOT) {
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      fs.writeFileSync(process.env.ROAD_SCREENSHOT,Buffer.from(shot.data,'base64'));
    }
    await evaluate('window.restoreRect()');
    await click('#reset');await click('#confirm-reset');assert.equal(await text('budget'),'36');
    assert.equal(await evaluate('document.querySelector("#road-grade").value'),'0');
    await drag(3,3,5,3);assert.equal(await text('budget'),'33');
    await click('#save-design');assert.equal(await evaluate('document.querySelector("#load-design").disabled'),false);
    await drag(5,3,6,3);assert.equal(await text('budget'),'32');
    await click('#load-design');assert.equal(await evaluate('document.querySelector("#load-dialog").open'),true);
    await click('#confirm-load');assert.equal(await text('budget'),'33');assert.equal(await text('phase-label'),'规划中');
    await click('#start');await delay(100);await click('#stop');assert.equal(await evaluate('document.querySelector("#stop-dialog").open'),true);
    await click('#confirm-stop');assert.equal(await text('phase-label'),'规划中');assert.equal(await text('delivered'),'0');assert.equal(await text('timer'),'01:30');
    await drag(5,3,10,3);assert.equal(await text('budget'),'28');
    await drag(2,3,3,3);await drag(10,3,11,3);assert.equal(await text('connection-count'),'1 / 2');
    await click('#cut-tool');await drag(5,3,7,3);assert.equal(await text('budget'),'28');assert.equal(await text('connection-count'),'0 / 2');
    await click('#road-tool');await drag(5,3,7,3);assert.equal(await text('connection-count'),'1 / 2');
    await click('.level-card:nth-child(2)');assert.equal(await evaluate('document.querySelector("#level-dialog").open'),true);
    await click('#cancel-level');assert.equal(await text('map-name'),'晨光街区');assert.equal(await text('budget'),'28');
    await click('.level-card:nth-child(2)');await click('#confirm-level');assert.equal(await text('budget'),'64');
    // Check the original fast-drag path and dynamic route status.
    await drag(2,2,2,3);await drag(2,3,12,3);
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
    await drag(2,3,11,3);await drag(4,8,12,8);await click('#start');await delay(350);
    assert.equal(await evaluate('window.testCity.state'),'won');
    assert.equal(await evaluate('document.querySelector("#next-level").hidden'),false);
    await click('#next-level');assert.equal(await text('map-name'),'河畔新城');assert.equal(await text('phase-label'),'规划中');
    await click('.level-card:nth-child(5)');
    // Force final-level success to check navigation bounds; core tests check actual solvability.
    await evaluate('TrafficCore.City.prototype.step=function(){this.state="won";this.delivered=this.level.target;};');
    await click('#start');await delay(120);
    assert.equal(await evaluate('document.querySelector("#next-level").hidden'),true);
    await click('#play-again');assert.equal(await text('map-name'),'都会早高峰');
    for (const width of [320,768,1024]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<760});await delay(50);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`layout overflow at ${width}px`);
    }
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(100);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    assert.equal(await evaluate('[...document.querySelectorAll(".level-card")].every(el=>el.getBoundingClientRect().right<=innerWidth)'),true);
    await evaluate('document.querySelector("canvas").scrollIntoView({block:"center"})');await delay(100);
    const r=await evaluate('(()=>{const r=document.querySelector("canvas").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
    const touch=(type,x,y)=>send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:r.x+(x+.5)*r.w/16,y:r.y+(y+.5)*r.h/12}]});
    await touch('touchStart',3,2);await touch('touchMove',6,2);await touch('touchEnd');
    assert.equal(await text('budget'),'48');
    await select('road-grade','2');
    await touch('touchStart',3,2);await touch('touchMove',6,2);await touch('touchEnd');
    assert.equal(await text('budget'),'40');
    await click('#cut-tool');await touch('touchStart',4,2);await touch('touchMove',5,2);await touch('touchEnd');
    assert.equal(await text('budget'),'40');await click('#save-design');
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("traffic-game-design-v1:rush-hour")).edges.some(([a,b])=>a===36&&b===37)'),false);
    await click('#road-tool');await touch('touchStart',4,2);await touch('touchMove',5,2);await touch('touchEnd');
    await click('#save-design');
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("traffic-game-design-v1:rush-hour")).edges.some(([a,b])=>a===36&&b===37)'),true);
    await click('#inspect-tool');await touch('touchStart',3,2);await touch('touchEnd');
    assert.ok((await text('road-detail')).includes('快速路'));
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    if(process.env.SCREENSHOT) {
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      fs.writeFileSync(process.env.SCREENSHOT,Buffer.from(shot.data,'base64'));
    }
    assert.deepEqual(errors,[]);
    console.log('Browser smoke passed: 5 levels, save/load designs, stop/replan, switching confirmation, pause/reset, win/loss/next-level, road grades/refunds, junction signals/settings, explicit drag connections, scissors, default yielding, mobile layout and touch cuts/upgrades; no runtime or CSP errors.');
  } finally {
    await fetch(`${endpoint}/json/close/${tab.id}`).catch(()=>{});
    ws.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
