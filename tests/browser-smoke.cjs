/* Optional browser integration test. Requires Node.js 22+, a running game server,
 * and Chromium exposing a local DevTools endpoint on port 9333. */
'use strict';
const assert = require('node:assert/strict');
const LEVELS = require('../built-in-levels.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const endpoint=process.env.CDP_URL||'http://127.0.0.1:9333';
  const url=process.env.GAME_URL||'http://127.0.0.1:8180';
  const tab=await (await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`,{method:'PUT'})).json();
  const ws=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map(),errors=[];let seq=0;
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id){const job=pending.get(message.id);pending.delete(message.id);message.error?job.reject(message.error):job.resolve(message.result);}
    else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
    else if(message.method==='Log.entryAdded'&&message.params.entry.level==='error')errors.push(message.params.entry);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const text=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
  const select=(id,value)=>evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  async function dragThrough(points){
    const r=await evaluate('(()=>{const r=document.querySelector("canvas").getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()');
    const mouse=(type,x,y)=>send('Input.dispatchMouseEvent',{type,x:r.x+(x+.5)*r.w/16,y:r.y+(y+.5)*r.h/12,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
    await mouse('mousePressed',...points[0]);
    for(const point of points.slice(1))await mouse('mouseMoved',...point);
    await mouse('mouseReleased',...points[points.length-1]);
  }
  const drag=(x1,y1,x2,y2)=>dragThrough([[x1,y1],[x2,y2]]);
  async function go(index){
    await click(`.level-card:nth-child(${index+1})`);
    if(await evaluate('document.querySelector("#level-dialog").open'))await click('#confirm-level');
  }
  try {
    await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1200,deviceScaleFactor:1,mobile:false});
    await evaluate('localStorage.clear()');await send('Page.reload');await delay(400);
    assert.equal(await evaluate('document.querySelectorAll(".level-card").length'),7);
    for(let i=0;i<LEVELS.length;i++){
      await click(`.level-card:nth-child(${i+1})`);
      assert.equal(await evaluate('document.querySelector("#level-dialog").open'),false,'default design should switch without confirmation');
      assert.equal(await text('map-name'),LEVELS[i].name);
      const initial=new (require('../core.js').City)(LEVELS[i].id);
      assert.equal(await text('budget'),String(initial.remaining));
      assert.equal(await evaluate('document.querySelectorAll("#demand-list li").length'),LEVELS[i].routes.length);
      assert.equal(await evaluate('document.querySelectorAll(".connection-row").length'),LEVELS[i].routes.length);
    }

    await go(0);
    assert.equal(await evaluate('document.querySelector("#road-grade")'),null);
    assert.ok(await evaluate('document.querySelector("#select-tool")!==null'));
    await drag(3,3,3,3);assert.equal(await text('budget'),'36','selection must not build');
    await click('#road-tool');await drag(2,3,5,3);assert.equal(await text('budget'),'33');
    await drag(3,3,4,3);assert.equal(await text('budget'),'33','a road between a building and road is not an endpoint');
    await drag(2,3,3,3);assert.equal(await text('budget'),'34','a single-exit building acts as the endpoint and retracts');
    await drag(2,3,3,3);assert.equal(await text('budget'),'33','a building should rebuild toward empty land as a local road');
    await dragThrough([[5,3],[6,3],[5,3],[4,3]]);
    assert.equal(await text('budget'),'33','returning to the origin cancels the extension without changing drag intent');
    await drag(4,3,5,3);assert.equal(await text('budget'),'35','endpoint retraction must remove the final dragged road too');
    await click('#save-design');await drag(5,3,6,3);assert.equal(await text('budget'),'33');
    await click('#load-design');await click('#confirm-load');assert.equal(await text('budget'),'35');

    await click('.level-card:nth-child(2)');
    assert.equal(await evaluate('document.querySelector("#level-dialog").open'),true,'modified design should require confirmation');
    await click('#confirm-level');
    assert.equal(await text('budget'),'0');
    assert.equal(await evaluate('document.querySelector("#erase-tool")'),null);
    await drag(13,4,13,4);await click('#remove-road');
    assert.ok(Number(await text('budget'))>0);
    await click('#save-design');await click('#road-tool');

    await go(2);
    assert.equal(await evaluate('document.querySelector("#load-setting").hidden'),false);
    assert.ok((await text('demand-list')).includes('输出 330 人 · 6 人/s'));
    const previousBudget=Number(await text('budget'));
    await click('#road-tool');await drag(3,2,5,2);assert.ok(Number(await text('budget'))<previousBudget);
    await click('#select-tool');await drag(3,2,5,2);await click('#upgrade-road');
    assert.ok((await text('road-detail')).includes('3 × 1'));
    await drag(3,2,3,2);assert.ok((await text('road-detail')).includes('每方向'));

    await go(3);
    await click('#road-tool');await drag(3,2,3,3);
    await click('#select-tool');await drag(3,3,3,3);
    assert.equal(await evaluate('document.querySelector("#signal-enabled").disabled'),false);
    await click('#signal-enabled');assert.ok((await text('signal-phase')).includes('绿灯'));

    await go(4);
    await click('#road-tool');await drag(5,3,5,10);
    assert.equal(await evaluate('document.querySelector("#select-tool").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#signal-enabled").disabled'),true);
    await click('#select-tool');await drag(5,4,5,4);
    assert.equal(await evaluate('document.querySelector("#signal-enabled").disabled'),false);
    assert.ok((await text('signal-phase')).includes('35%'));
    await click('#signal-enabled');assert.ok((await text('signal-phase')).includes('绿灯'));
    assert.equal(await evaluate('document.querySelector("#road-inspector").closest(".board-panel")!==null'),true);

    // Force one deterministic arrival and verify both celebration state and report.
    await evaluate(`(()=>{const step=TrafficCore.City.prototype.step;TrafficCore.City.prototype.step=function(dt){
      if(!this.arrivals.length){this.delivered=1;this.commuteTimes=[7];this.arrivals=[{route:0,time:1,commuteTime:7}];}
      this.state='won';TrafficCore.City.prototype.step=step;
    };})()`);
    await click('#start');await delay(150);
    assert.equal(await evaluate('document.querySelector("#result-dialog").open'),true);
    assert.ok((await text('result-stats')).includes('居民满意度 100%'));
    assert.ok((await text('result-stats')).includes('轻松通勤 1 人'));

    for(const width of [320,768,1024]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<760});await delay(60);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`overflow at ${width}px`);
    }
    assert.deepEqual(errors,[]);
    console.log('Browser smoke passed: 7 progressive levels, selection, endpoint retract, transactional drag, road grades, signals, save/load, commute report and responsive layout.');
  } finally {
    await fetch(`${endpoint}/json/close/${tab.id}`).catch(()=>{});ws.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
