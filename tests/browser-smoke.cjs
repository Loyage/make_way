/* Optional lean player browser smoke test. Requires Node.js 22+, a running game
 * server, and Chromium exposing a local DevTools endpoint on port 9333. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const CATALOG = require('../src/shared/level-catalog.js').loadCatalogSync(path.join(__dirname, '..', 'built-in-levels.json'));
const LEVELS = CATALOG.chapters.filter(chapter=>!chapter.hidden).flatMap(chapter=>chapter.levels);
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
    else if(message.method==='Log.entryAdded'&&message.params.entry.level==='error'){
      const entry=message.params.entry,optional=entry.url?.endsWith('/levels.json')&&entry.text.includes('404'),favicon=entry.url?.endsWith('/favicon.ico')&&entry.text.includes('404');
      if(!optional&&!favicon)errors.push(entry);
    }
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const click=selector=>evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});const details=element.closest('details');if(details&&!element.matches('summary'))details.open=true;element.click();})()`);
  const text=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
  async function waitFor(expression,label,attempts=60){for(let i=0;i<attempts;i++){if(await evaluate(expression))return;await delay(50);}assert.fail(label);}
  async function drag(x1,y1,x2,y2) {
    await evaluate('document.querySelector("#map").scrollIntoView({block:"center"})');await delay(50);
    const box=await evaluate('(()=>{const r=document.querySelector("#map").getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()');
    const at=(x,y)=>({x:box.x+(x+.5)*box.w/16,y:box.y+(y+.5)*box.h/12});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...at(x1,y1),button:'left',buttons:1,clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...at(x2,y2),button:'left',buttons:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...at(x2,y2),button:'left',buttons:0,clickCount:1});
  }
  async function press(key,code,keyCode,modifiers=0){
    await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode,modifiers});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode,modifiers});
  }
  try {
    await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url});
    await waitFor('window.TrafficGameAdmin?.currentLevelId()','game startup');
    await evaluate('localStorage.clear()');await send('Page.reload');
    await waitFor('window.TrafficGameAdmin?.currentLevelId()','clean game reload');

    assert.equal(await text('map-name'),LEVELS[0].name);
    assert.equal(await evaluate('document.querySelectorAll(".chapter-tab").length'),3);
    assert.equal(await evaluate('document.querySelector("#level-picker").open'),false);
    assert.equal(await evaluate('document.querySelector("#context-guide").hidden'),false,'first visit shows onboarding');
    await click('#skip-context-guide');
    await click('#level-picker > summary');await click('.chapter-tab:nth-child(2)');
    await click(`.level-card[data-level-id="${CATALOG.chapters[1].levels[0].id}"]`);
    assert.equal(await text('map-name'),CATALOG.chapters[1].levels[0].name,'catalog navigation switches levels');
    await evaluate(`TrafficGameAdmin.applyCatalog(${JSON.stringify(CATALOG)},${JSON.stringify(LEVELS[0].id)})`);

    await click('#road-tool');await drag(5,4,9,4);
    assert.equal(await text('budget'),'33','pointer drag builds an interpolated road');
    await press('z','KeyZ',90,2);assert.equal(await text('budget'),'36','keyboard shortcut undoes planning');
    await press('y','KeyY',89,2);assert.equal(await text('budget'),'33','keyboard shortcut redoes planning');
    for(const [key,code,keyCode,tool] of [['1','Digit1',49,'view-tool'],['2','Digit2',50,'select-tool'],['3','Digit3',51,'road-tool']]){
      await press(key,code,keyCode);assert.equal(await evaluate(`document.querySelector('#${tool}').getAttribute('aria-pressed')`),'true');
    }

    await click('#start');assert.equal(await evaluate('document.querySelector("#preflight-dialog").open'),true,'start reaches preflight');
    await click('#confirm-preflight');await delay(100);
    assert.ok((await text('board-status')).includes('运营中'));
    await click('#stop');assert.equal(await evaluate('document.querySelector("#stop-dialog").open'),true);
    await click('#confirm-stop');assert.equal(await text('traffic'),'等待出发');

    for(const {width,mobile} of [{width:390,mobile:true},{width:1280,mobile:false}]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile});await delay(80);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`no horizontal overflow at ${width}px`);
      assert.equal(await evaluate('document.querySelector("#map").getBoundingClientRect().height>=180'),true,`map remains usable at ${width}px`);
      if(mobile)assert.equal(await evaluate('Array.from(document.querySelectorAll(".toolbar button:not([hidden]), .zoom-controls button")).every(button=>button.getBoundingClientRect().height>=44)'),true,'mobile touch targets remain usable');
    }
    assert.deepEqual(errors,[]);
    console.log('Browser smoke passed: startup, catalog navigation, pointer and keyboard planning, operation controls, and mobile/desktop layout.');
  } finally {
    await fetch(`${endpoint}/json/close/${tab.id}`).catch(()=>{});ws.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
