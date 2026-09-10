/* Optional browser integration test. Requires Node.js 22+, a running game server,
 * and Chromium exposing a local DevTools endpoint on port 9333. */
'use strict';
const assert = require('node:assert/strict');
const CATALOG = require('../level-catalog.js').loadCatalogSync(require('node:path').join(__dirname, '..', 'built-in-levels.json'));
const LEVELS = CATALOG.chapters.flatMap(chapter => chapter.levels);
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
  const click=selector=>evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});const details=element.closest('details');if(details&&!element.matches('summary'))details.open=true;element.click();})()`);
  const text=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
  const select=(id,value)=>evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  async function dragThrough(points){
    await evaluate('document.querySelector("canvas").scrollIntoView({block:"center"})');
    await delay(100);
    const r=await evaluate('(()=>{const r=document.querySelector("canvas").getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()');
    const mouse=(type,x,y)=>send('Input.dispatchMouseEvent',{type,x:r.x+(x+.5)*r.w/16,y:r.y+(y+.5)*r.h/12,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
    await mouse('mousePressed',...points[0]);
    for(const point of points.slice(1))await mouse('mouseMoved',...point);
    await mouse('mouseReleased',...points[points.length-1]);
  }
  const drag=(x1,y1,x2,y2)=>dragThrough([[x1,y1],[x2,y2]]);
  async function go(index){
    const level=LEVELS[index],chapterIndex=CATALOG.chapters.findIndex(chapter=>chapter.levels.some(item=>item.id===level.id));
    await click(`.chapter-tab:nth-child(${chapterIndex+1})`);
    await click(`.level-card[data-level-id="${level.id}"]`);
    if(await evaluate('document.querySelector("#level-dialog").open'))await click('#confirm-level');
  }
  try {
    await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1200,deviceScaleFactor:1,mobile:false});
    await evaluate('localStorage.clear()');await send('Page.reload');await delay(400);
    assert.equal(await evaluate('document.querySelector("#level-picker").open'),false);
    assert.equal(await evaluate('document.querySelector(".design-menu").open'),false);
    await click('#level-picker > summary');
    assert.equal(await evaluate('document.querySelector("#level-picker").open'),true);
    await click('#level-picker > summary');
    assert.equal(await evaluate('document.querySelectorAll(".chapter-tab").length'),2);
    assert.equal(await evaluate('document.querySelectorAll(".level-card").length'),CATALOG.chapters[0].levels.length);
    for(let i=0;i<LEVELS.length;i++){
      const chapterIndex=CATALOG.chapters.findIndex(chapter=>chapter.levels.some(level=>level.id===LEVELS[i].id));
      await click(`.chapter-tab:nth-child(${chapterIndex+1})`);
      assert.equal(await evaluate('document.querySelectorAll(".level-card").length'),CATALOG.chapters[chapterIndex].levels.length);
      await click(`.level-card[data-level-id="${LEVELS[i].id}"]`);
      assert.equal(await evaluate('document.querySelector("#level-dialog").open'),false,'default design should switch without confirmation');
      assert.equal(await text('map-name'),LEVELS[i].name);
      assert.equal(await text('level-summary'),`当前：${LEVELS[i].name}`);
      assert.equal(await evaluate('document.querySelector("#level-picker").open'),false);
      if(i>0)assert.equal(await text('toast'),LEVELS[i].description);
      assert.equal(await text('mission-tip'),LEVELS[i].tip);
      assert.equal(await evaluate('getComputedStyle(document.querySelector("#mission-tip")).whiteSpace'),'pre-line');
      const initial=new (require('../core.js').City)(LEVELS[i].id);
      assert.equal(await text('budget'),String(initial.remaining));
      assert.equal(await evaluate('document.querySelectorAll("#demand-list li").length'),LEVELS[i].routes.length);
      assert.equal(await evaluate('document.querySelectorAll(".connection-row").length'),LEVELS[i].routes.length);
    }
    assert.equal(await evaluate('document.querySelector("#bus-tool").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#bus-controls").hidden'),false);
    assert.ok(await evaluate('document.querySelector("#bus-line-select")'));
    assert.ok(await evaluate('document.querySelector("#new-bus-line")!==null && document.querySelector("#trim-bus")!==null && document.querySelector("#redraw-bus")!==null && document.querySelector("#delete-bus")!==null'));
    assert.ok(await evaluate('document.querySelector("#bus-return-trip")!==null && document.querySelector("#bus-return-stops")!==null && document.querySelector("#bus-headway")!==null && document.querySelector("#bus-line-visibility")!==null'));

    await go(0);
    assert.equal(await evaluate('document.querySelector("#road-grade")'),null);
    assert.ok(await evaluate('document.querySelector("#signal-yield-mode")!==null && document.querySelector("#signal-automatic")!==null'));
    assert.ok(await evaluate('document.querySelector("#signal-priority-list")!==null && document.querySelector("#signal-phase-list")!==null && document.querySelector("#add-signal-phase")!==null && document.querySelector("#suggest-signal-phases")!==null'));
    assert.ok(await evaluate('document.querySelector("#select-tool")!==null'));
    assert.equal(await evaluate('document.querySelectorAll("#accessible-map [role=gridcell]").length'),192);
    assert.ok(await evaluate('document.querySelector("#accessible-map [role=gridcell]").getAttribute("aria-label").includes("第 1 行第 1 列")'));
    for(const expected of ['2×','4×','0.5×','1×']){await click('#speed');assert.equal(await text('speed'),expected);}
    assert.equal(await evaluate('document.querySelector("#speed").getAttribute("aria-label")'),'切换运营倍速，当前 1 倍');
    await drag(3,3,3,3);assert.equal(await text('budget'),'36','selection must not build');
    await click('#road-tool');await drag(2,3,5,3);assert.equal(await text('budget'),'33');
    await click('#undo-design');assert.equal(await text('budget'),'36','undo restores the previous planning design');
    await click('#redo-design');assert.equal(await text('budget'),'33','redo reapplies the reverted planning design');
    await drag(3,3,4,3);assert.equal(await text('budget'),'33','dragging over roads only preserves or adds connections');
    await drag(2,3,3,3);assert.equal(await text('budget'),'33','dragging from a building never retracts roads');
    await dragThrough([[5,3],[6,3],[5,3],[4,3]]);
    assert.equal(await text('budget'),'33','returning along the preview cancels new construction');
    await click('#select-tool');await drag(5,3,5,3);await click('#remove-road');assert.equal(await text('budget'),'34','explicit removal refunds the selected road');
    await click('#save-design');await click('#road-tool');await drag(5,3,6,3);assert.equal(await text('budget'),'32');
    await click('#load-design');await click('#confirm-load');assert.equal(await text('budget'),'34');

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
    assert.ok((await text('demand-list')).includes('共 330 人 · 产生 6 人/s'));
    const previousBudget=Number(await text('budget'));
    await click('#road-tool');await drag(3,2,5,2);assert.ok(Number(await text('budget'))<previousBudget);
    await click('#select-tool');await drag(3,2,5,2);await click('#upgrade-road');
    assert.ok((await text('road-detail')).includes('3 × 1'));
    await drag(3,2,3,2);assert.ok((await text('road-detail')).includes('每方向'));

    await go(3);
    assert.equal(await evaluate('document.querySelector("#cut-tool").hidden'),false);
    assert.equal(await evaluate('document.querySelector("#cut-tool").disabled'),false);
    assert.equal(await text('budget'),'0','cut-school pre-builds every road');
    await click('#cut-tool');await drag(7,4,7,5);
    assert.equal(await text('budget'),'0','scissors disconnect without refunding');

    await go(4);
    await click('#road-tool');await drag(3,2,3,3);
    await click('#select-tool');await drag(3,3,3,3);
    assert.equal(await evaluate('document.querySelector("#signal-enabled").disabled'),false);
    await click('#signal-enabled');assert.ok((await text('signal-phase')).includes('绿灯'));
    await click('#signal-automatic');await click('.signal-phase-card input');
    assert.equal(await evaluate('document.querySelector(".signal-phase-card input").checked'),true,'conflicting action remains selected for further editing');
    assert.equal(await evaluate('document.querySelector(".signal-phase-card").classList.contains("conflicted")'),true);
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#signal-phase-list")).gridTemplateColumns.split(" ").length'),2,'desktop signal phases should use the available width');
    await click('#start');assert.equal(await text('preflight-title'),'地图设计有问题');
    assert.equal(await evaluate('document.querySelector("#confirm-preflight").hidden'),true);
    assert.ok((await text('preflight-list')).includes('路口 (4,4)'));
    await click('.preflight-blocking .tool');assert.equal(await evaluate('document.querySelector("#preflight-dialog").open'),false);

    await go(5);
    assert.equal(await evaluate('document.querySelector("#campaign-progress").hidden'),false);
    assert.equal(await evaluate('document.querySelectorAll(".campaign-day").length'),5);
    assert.equal(await evaluate('document.querySelector("#legend-site").hidden'),false);
    assert.ok((await text('campaign-day-title')).includes('第 1 天'));

    await go(6);
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
    await click('#start');await delay(80);
    assert.equal(await evaluate('document.querySelector("#preflight-dialog").open'),true);
    assert.ok((await text('preflight-summary')).includes('理论最多可送达'));
    await click('#confirm-preflight');await delay(150);
    assert.equal(await evaluate('document.querySelector("#result-dialog").open'),true);
    assert.ok((await text('result-stats')).includes('居民满意度 100%'));
    assert.ok((await text('result-stats')).includes('轻松通勤 1 人'));

    for(const width of [320,390,760,768,1024,1440]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<760});await delay(60);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`overflow at ${width}px`);
      await click('[data-mobile-panel="demand"]');
      assert.equal(await evaluate('document.querySelector("[data-mobile-panel=demand]").getAttribute("aria-pressed")'),'true');
      assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-info-panel=demand]")).display'),'block');
      assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-info-panel=mission]")).display'),'none');
      await click('[data-mobile-panel="mission"]');
      if(width<=760)assert.equal(await evaluate('Array.from(document.querySelectorAll(".toolbar button:not([hidden]), .zoom-controls button")).every(button=>button.getBoundingClientRect().height>=44)'),true,'touch targets must be at least 44px');
    }
    assert.deepEqual(errors,[]);
    console.log('Browser smoke passed: 10 progressive levels, five-day progress, scissors, bus controls, selection, endpoint retract, transactional drag, road grades, signals, save/load, commute report and responsive layout.');
  } finally {
    await fetch(`${endpoint}/json/close/${tab.id}`).catch(()=>{});ws.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
