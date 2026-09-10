/* Optional administrator browser integration test. Requires Node.js 22+, a running
 * admin server, and Chromium exposing a local DevTools endpoint on port 9333.
 * API calls are intercepted in Chromium, so this test never writes level files. */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const CATALOG = require('../src/shared/level-catalog.js').loadCatalogSync(path.join(__dirname, '..', 'built-in-levels.json'));
const Core = require('../src/shared/core.js');
const { buildReferencePlan } = require('./reference-plan.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const endpoint=process.env.CDP_URL||'http://127.0.0.1:9333';
  const url=process.env.ADMIN_URL||'http://127.0.0.1:8080';
  const tab=await (await fetch(`${endpoint}/json/new?${encodeURIComponent('about:blank')}`,{method:'PUT'})).json();
  const ws=new WebSocket(tab.webSocketDebuggerUrl),pending=new Map(),errors=[],dialogs=[];
  let seq=0,authenticated=false,loginRequests=0,publishRequests=0,publishedCatalog=null;
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  async function fulfill(requestId,status,payload){
    const body=JSON.stringify(payload);
    await send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json; charset=utf-8'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from(body).toString('base64')});
  }
  async function handleApi(message){
    const {requestId,request}=message.params,requestUrl=new URL(request.url),method=request.method;
    if(requestUrl.pathname==='/api/login'&&method==='POST'){
      loginRequests++;
      const password=JSON.parse(request.postData||'{}').password;
      authenticated=password==='browser-test-password';
      return fulfill(requestId,authenticated?200:401,authenticated?{ok:true}:{error:'密码错误'});
    }
    if(requestUrl.pathname==='/api/levels'&&method==='GET')return fulfill(requestId,authenticated?200:401,authenticated?{catalog:CATALOG,hasOverride:false}:{error:'未登录'});
    if(requestUrl.pathname==='/api/validate'&&method==='POST')return fulfill(requestId,200,{ok:true,errors:[]});
    if(requestUrl.pathname==='/api/levels'&&method==='PUT'){
      publishRequests++;publishedCatalog=JSON.parse(request.postData||'null');
      return fulfill(requestId,200,{ok:true,chapters:publishedCatalog.chapters.length,count:publishedCatalog.chapters.flatMap(chapter=>chapter.levels).length});
    }
    return fulfill(requestId,404,{error:'浏览器测试未模拟此 API'});
  }
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id){const job=pending.get(message.id);pending.delete(message.id);message.error?job.reject(message.error):job.resolve(message.result);}
    else if(message.method==='Fetch.requestPaused')handleApi(message).catch(error=>errors.push({text:error.stack||String(error)}));
    else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
    else if(message.method==='Page.javascriptDialogOpening')dialogs.push(message.params);
    else if(message.method==='Log.entryAdded'&&message.params.entry.level==='error'){
      const entry=message.params.entry,expectedUnauthorized=entry.url?.endsWith('/api/levels')&&entry.text.includes('401'),missingFavicon=entry.url?.endsWith('/favicon.ico')&&entry.text.includes('404');
      if(!expectedUnauthorized&&!missingFavicon)errors.push(entry);
    }
  });
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const click=selector=>evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});const details=element.closest('details');if(details&&!element.matches('summary'))details.open=true;element.click();})()`);
  const change=(id,value)=>evaluate(`(()=>{const element=document.getElementById(${JSON.stringify(id)});element.value=${JSON.stringify(String(value))};element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const text=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).textContent`);
  async function waitFor(expression,message,timeout=3000){
    const started=Date.now();
    while(Date.now()-started<timeout){try{if(await evaluate(expression))return;}catch{/* document may still be navigating */}await delay(50);}
    let state=null;try{state=await evaluate(`({loginHidden:document.querySelector('#admin-login')?.hidden,loginError:document.querySelector('#admin-login-error')?.textContent,catalog:Boolean(window.TrafficAdminCatalog),game:Boolean(window.TrafficGameAdmin),inspectorHidden:document.querySelector('#admin-inspector')?.hidden,toast:document.querySelector('#toast')?.textContent})`);}catch{/* retain the timeout as the primary failure */}
    throw new Error(`Timed out waiting for ${message}: ${JSON.stringify({state,errors})}`);
  }
  try {
    await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
    await send('Fetch.enable',{patterns:[{urlPattern:'*/api/*',requestStage:'Request'}]});
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url});
    await waitFor('document.readyState==="complete"&&window.TrafficAdminReady&&document.querySelector("#admin-login")&&!document.querySelector("#admin-login").hidden','administrator login');
    await change('admin-password','browser-test-password');await click('#admin-login-form button[type="submit"]');
    await waitFor('window.TrafficGameAdmin&&!document.querySelector("#admin-inspector").hidden','administrator editor');
    assert.equal(loginRequests,1);
    assert.equal(await evaluate('document.querySelector("#admin-login").hidden'),true);

    await click('#road-tool');
    await evaluate('document.querySelector("#map").scrollIntoView({block:"center"})');await delay(100);
    const points=await evaluate(`(()=>{const canvas=document.querySelector('#map'),rect=canvas.getBoundingClientRect(),width=16,height=12,size=Math.min(rect.width/width,rect.height/height),left=rect.left+(rect.width-width*size)/2,top=rect.top+(rect.height-height*size)/2,at=cell=>({x:left+(cell%width+.5)*size,y:top+(Math.floor(cell/width)+.5)*size});return {start:at(69),end:at(73)};})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...points.start,button:'left',buttons:1,clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...points.end,button:'left',buttons:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...points.end,button:'left',buttons:0,clickCount:1});
    await waitFor('[70,71,72].every(cell=>TrafficGameAdmin.captureDesign().roads.some(road=>road.cell===cell))','gap-free fast road drag');
    assert.equal(await evaluate(`[[69,70],[70,71],[71,72],[72,73]].every(([a,b])=>TrafficGameAdmin.captureDesign().edges.some(edge=>edge[0]===a&&edge[1]===b))`),true);

    await change('admin-level',1);
    await waitFor('TrafficGameAdmin.currentLevelId()==="demolition-school"','demolition lesson editor');
    assert.equal(await evaluate('TrafficCore.LEVELS.find(level=>level.id==="demolition-school").initialEdges.some(edge=>edge.includes(36))'),true);
    await click('#admin-add-home');
    await waitFor('TrafficCore.LEVELS.find(level=>level.id==="demolition-school").routes[0].homes.length===2','second home');
    await click('#admin-homes .admin-building-card:first-child .admin-danger');
    await waitFor('TrafficCore.LEVELS.find(level=>level.id==="demolition-school").routes[0].homes.length===1','home deletion');
    assert.equal(await evaluate('TrafficCore.LEVELS.find(level=>level.id==="demolition-school").initialEdges.every(edge=>!edge.includes(36))'),true,'deleting a building must remove its stale initial exit');
    await click('#admin-undo');
    await waitFor('TrafficCore.LEVELS.find(level=>level.id==="demolition-school").routes[0].homes.length===2','home deletion undo');
    await evaluate('TrafficGameAdmin.selectCell(37)');
    await click('#admin-homes .admin-building-card:first-child > button:last-child');
    await waitFor('TrafficCore.LEVELS.find(level=>level.id==="demolition-school").routes[0].homes[0].cell===37','home movement');
    assert.equal(await evaluate(`(()=>{const level=TrafficCore.LEVELS.find(level=>level.id==='demolition-school');return !level.initialRoads.some(road=>road.cell===37)&&level.initialEdges.every(edge=>!edge.includes(36)&&!edge.includes(37));})()`),true,'moving a building must remove conflicting road and stale exits');
    assert.equal((await text('admin-validation')).includes('预览失败'),false);
    await click('#admin-undo');await waitFor('TrafficCore.LEVELS.find(level=>level.id==="demolition-school").routes[0].homes[0].cell===36','home movement undo');
    await click('#admin-undo');await waitFor('TrafficCore.LEVELS.find(level=>level.id==="demolition-school").routes[0].homes.length===1','second home undo');
    await change('admin-level',0);await waitFor('TrafficGameAdmin.currentLevelId()==="neighborhood"','first lesson editor');
    assert.equal(await evaluate('document.querySelector("#admin-dirty").classList.contains("dirty")'),false);

    const first=CATALOG.chapters[0].levels[0],originalSatisfaction=first.starTargets.satisfaction,originalQueue=first.starTargets.efficiency.maxQueue;
    await change('admin-star-satisfaction',originalSatisfaction-1);
    await waitFor(`TrafficCore.LEVELS[0].starTargets.satisfaction===${originalSatisfaction-1}`,'star target preview');
    await send('Page.reload',{ignoreCache:true});
    const dialogStarted=Date.now();while(!dialogs.length&&Date.now()-dialogStarted<3000)await delay(50);
    assert.equal(dialogs.at(-1)?.type,'beforeunload','reloading an unpublished draft must open the browser safeguard');
    await send('Page.handleJavaScriptDialog',{accept:false});
    await waitFor(`TrafficCore.LEVELS[0].starTargets.satisfaction===${originalSatisfaction-1}`,'cancelled draft reload');
    assert.ok((await text('admin-trial-status')).includes('发布前须'));
    assert.equal(await evaluate('document.querySelector("#admin-dirty").classList.contains("dirty")'),true);

    await click('#admin-publish');
    await waitFor('document.querySelector("#admin-validation").textContent.includes("尚未通关")','blocked publication');
    assert.equal(publishRequests,0,'an unverified draft must not reach the publication API');
    assert.ok((await text('admin-validation')).includes(`关卡「${first.id}」须先验证并试玩通关`));

    await click('#admin-verify-play');
    await waitFor('document.body.classList.contains("admin-collapsed")','trial mode');
    assert.ok((await text('admin-trial-status')).includes('试玩进行中'));
    const planCity=new Core.City(first.id);buildReferencePlan(planCity);
    assert.equal(await evaluate(`TrafficGameAdmin.applyDesign(${JSON.stringify(planCity.serializeDesign())})`),'');
    await evaluate(`(()=>{const step=TrafficCore.City.prototype.step;TrafficCore.City.prototype.step=function(){this.delivered=this.target;this.generated=this.generated.map((_,index)=>this.homes[index].passengers);this.byRoute=this.routes.map(route=>route.homes.reduce((sum,home)=>sum+home.passengers,0));this.commuteTimes=Array(this.target).fill(1);this.state='won';TrafficCore.City.prototype.step=step;};})()`);
    await click('#start');
    await waitFor('document.querySelector("#preflight-dialog").open||document.querySelector("#result-dialog").open','trial start');
    if(await evaluate('document.querySelector("#preflight-dialog").open')){assert.equal(await evaluate('document.querySelector("#confirm-preflight").hidden'),false);await click('#confirm-preflight');}
    await waitFor('document.querySelector("#result-dialog").open','trial result');
    await waitFor('document.querySelector("#admin-trial-status").textContent.includes("已通过试玩门禁")','verified draft');
    assert.ok((await text('admin-validation')).includes('已实际通关'));
    assert.equal(await evaluate('document.body.classList.contains("admin-collapsed")'),false);

    await click('#view-city');
    await change('admin-star-queue',originalQueue+1);
    await waitFor('document.querySelector("#admin-trial-status").textContent.includes("发布前须")','changed draft invalidation');
    await click('#admin-publish');
    await waitFor('document.querySelector("#admin-validation").textContent.includes("尚未通关")','second blocked publication');
    assert.equal(publishRequests,0,'editing a verified level must invalidate its trial');

    await click('#admin-undo');
    await waitFor('document.querySelector("#admin-trial-status").textContent.includes("已通过试玩门禁")','verified fingerprint restoration');
    assert.equal(await evaluate(`TrafficCore.LEVELS[0].starTargets.efficiency.maxQueue===${originalQueue}`),true);
    await click('#admin-publish');
    await waitFor('document.querySelector("#admin-validation").textContent.includes("发布成功")','successful publication');
    assert.equal(publishRequests,1);
    assert.equal(publishedCatalog.chapters[0].levels[0].starTargets.satisfaction,originalSatisfaction-1);
    assert.equal(publishedCatalog.chapters[0].levels[0].starTargets.efficiency.maxQueue,originalQueue);
    assert.equal(await evaluate('document.querySelector("#admin-dirty").classList.contains("dirty")'),false);
    assert.deepEqual(errors,[]);
    console.log('Admin browser smoke passed: login, fast drag, safe building edits, reload protection, publication gate, trial completion, fingerprint invalidation, undo and publication.');
  } finally {
    await fetch(`${endpoint}/json/close/${tab.id}`).catch(()=>{});ws.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
