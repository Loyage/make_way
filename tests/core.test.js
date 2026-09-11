'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { City, WIDTH, HEIGHT, BUDGET, TARGET, ROUTES, key, point, neighbors, findPath } = require('../src/shared/core.js');
const { buildReferencePlan: connect } = require('./reference-plan.cjs');
function run(city, seconds) { for (let i = 0; i < seconds * 20; i++) city.step(.05); }

test('map coordinates and adjacency do not wrap at edges', () => {
  assert.deepEqual(point(key(15,11)), {x:15,y:11});
  assert.deepEqual(neighbors(0), [1,WIDTH]);
  assert.ok(!neighbors(15).includes(16));
  assert.equal(neighbors(WIDTH*HEIGHT-1).length, 2);
});
test('defaults to the first lesson in planning mode with no connections', () => {
  const city = new City();
  assert.equal(city.level.id,'neighborhood');
  assert.equal(city.remaining,BUDGET);assert.equal(city.roads.size,0);
  assert.ok(city.paths.every(p=>p===null));run(city,10);
  assert.equal(city.elapsed,0);assert.equal(city.cars.length,0);
});
test('planning hints track disconnected homes, estimated exit flow and refundable star cost', () => {
  const city=new City();
  assert.ok(city.planningHints().some(issue=>issue.code==='home-unreachable'));
  assert.ok(!city.planningHints().some(issue=>issue.code==='home-exit-pressure'));
  connect(city);
  const home=city.homes[0],rate=home.generationRate;
  home.generationRate=100;
  assert.ok(city.planningHints().some(issue=>issue.code==='home-exit-pressure'&&issue.cells[0]===home.cell));
  home.generationRate=.01;
  assert.ok(!city.planningHints().some(issue=>issue.code==='home-exit-pressure'&&issue.cells[0]===home.cell));
  home.generationRate=rate;
  const cost=city.budget-city.remaining,snapshot=JSON.stringify(city.serializeDesign());
  assert.ok(!city.planningHints({maxCost:cost}).some(issue=>issue.code==='star-cost'));
  assert.ok(city.planningHints({maxCost:cost-1}).some(issue=>issue.code==='star-cost'));
  assert.equal(JSON.stringify(city.serializeDesign()),snapshot);
  assert.equal(city.edit([...city.roads][0],true,0),'');
  assert.ok(!city.planningHints({maxCost:cost-1}).some(issue=>issue.code==='star-cost'));
  city.sandbox=true;
  assert.ok(!city.planningHints({maxCost:0}).some(issue=>issue.code==='star-cost'));
});

test('operation preflight reports reachability, capacity, theoretical limit and drag downgrades', () => {
  const city=new City(),empty=city.preflightCheck({suspiciousDowngrades:[key(0,0)]});
  assert.equal(empty.maxDeliverable,0);assert.ok(empty.issues.some(issue=>issue.code==='home-unreachable'));
  assert.ok(empty.issues.some(issue=>issue.code==='target-impossible'));
  assert.ok(!empty.issues.some(issue=>issue.code==='drag-downgrade'),'only existing road cells can be reported');
  connect(city);const ready=city.preflightCheck({suspiciousDowngrades:[[...city.roads][0]]});
  assert.equal(ready.maxDeliverable,city.target);assert.ok(!ready.issues.some(issue=>issue.code==='home-unreachable'));
  assert.ok(ready.issues.some(issue=>issue.code==='drag-downgrade'));
  for(const goal of city.goals)goal.input=0;
  const limited=city.preflightCheck();assert.equal(limited.maxDeliverable,0);
  assert.ok(limited.issues.some(issue=>issue.code==='route-capacity'));
});
test('sandbox has no deadline and permits safe road edits during operation', () => {
  const city=new City('neighborhood',{sandbox:true});connect(city);city.toggle();run(city,city.level.duration+5);
  assert.equal(city.state,'running');assert.equal(city.duration,Infinity);
  const empty=key(0,0);assert.equal(city.edit(empty,false,0),'');assert.ok(city.roads.has(empty));
  assert.equal(city.edit(empty,true,0),'');assert.ok(!city.roads.has(empty));
});
test('operation records peak home queues and deterministic road hotspots', () => {
  const city=new City();connect(city);city.toggle();run(city,3);
  assert.ok(city.maxHomeQueues.some(count=>count>0));
  const hotspots=city.roadHotspots();assert.ok(hotspots.length>0);assert.ok(hotspots.every(item=>item.occupancySeconds>0));
  assert.deepEqual(city.roadHotspots(0),[]);
  city.stop();assert.ok(city.maxHomeQueues.every(count=>count===0));assert.deepEqual(city.roadHotspots(),[]);
});
test('construction honors terrain, buildings, bridges, and refunds', () => {
  const city = new City();
  for (const n of [key(7,1),key(1,1),ROUTES[0].homes[0].cell]) assert.ok(city.edit(n));
  assert.equal(city.remaining,BUDGET);
  const riverCity=new City('rush-hour'),bridge=key(7,2);
  assert.equal(riverCity.roads.has(bridge),false);assert.ok(riverCity.edit(key(7,1)));
  assert.equal(riverCity.edit(bridge),'');assert.ok(riverCity.roads.has(bridge));
  assert.equal(riverCity.edit(bridge,true),'');assert.equal(riverCity.roads.has(bridge),false);
  city.edit(key(0,0));assert.equal(city.remaining,BUDGET-1);
  city.edit(key(0,0));assert.equal(city.remaining,BUDGET-1);
  city.edit(key(0,0),true);assert.equal(city.remaining,BUDGET);
});
test('cannot exceed road budget', () => {
  const city = new City();
  for(let n=0;n<WIDTH*HEIGHT;n++) city.edit(n);
  assert.equal(city.remaining,0);assert.equal(city.roads.size,BUDGET);
});
test('construction-only connections preserve existing grades and create branch roads',()=>{
  const city=new City(),a=key(0,0),b=key(1,0),c=key(2,0);city.trees.delete(a);city.trees.delete(b);city.trees.delete(c);
  assert.equal(city.edit(a,false,2),'');assert.equal(city.edit(b,false,1),'');
  assert.equal(city.connect(a,b,null),'');assert.equal(city.roadGrades.get(a),2);assert.equal(city.roadGrades.get(b),1);
  assert.equal(city.connect(b,c,null),'');assert.equal(city.roadGrades.get(b),1);assert.equal(city.roadGrades.get(c),0);
});
test('multi-step map transactions commit or roll back atomically', () => {
  const city=new City(),before=city.serializeDesign();
  const blocked=key(7,1),a=key(0,0),b=key(1,0);
  assert.ok(city.transact([{type:'connect',a,b,grade:0},{type:'edit',cell:blocked,erase:false,grade:0}]));
  assert.deepEqual(city.serializeDesign(),before);
  assert.equal(city.transact([{type:'connect',a,b,grade:1},{type:'edit',cell:a,erase:false,grade:2}]),'');
  assert.ok(city.edges.get(a).has(b));assert.equal(city.roadGrades.get(a),2);assert.equal(city.roadGrades.get(b),1);
});
test('BFS finds shortest four-way route and never traverses unrelated buildings', () => {
  const roads = new Set([key(1,0),key(2,0)]);
  assert.deepEqual(findPath(roads,0,key(3,0)),[0,1,2,3]);
  assert.equal(findPath(roads,0,key(4,0)),null);
  assert.equal(findPath(new Set([key(1,1)]),0,key(2,1)),null);
});
test('travel explanations and passenger breakdowns stay consistent', () => {
  const city=new City();
  assert.match(city.homeTravelInfo(0).reason,/没有明确连接道路出口/);
  connect(city);
  const info=city.homeTravelInfo(0);assert.ok(info.path.length>1);assert.ok(Number.isInteger(info.carGoalIndex));
  assert.equal(info.distance,info.path.length-1);assert.ok(info.freeFlowTime>0);assert.ok(info.bottlenecks.length>0);
  assert.deepEqual(city.passengerBreakdown(),{total:city.target,ungenerated:city.target,waiting:0,carTransit:0,busTransit:0,arrived:0});
  city.toggle();
  for(let i=0;i<200&&city.state==='running';i++){
    city.step(.05);const counts=city.passengerBreakdown();
    assert.equal(counts.total,counts.ungenerated+counts.waiting+counts.carTransit+counts.busTransit+counts.arrived);
  }
  const goal=city.goalBreakdown(0);assert.equal(goal.arrived+goal.reserved,city.goalAssigned[0]);
});
test('a starter plan connects all routes and wins within the time limit', () => {
  const city = new City();connect(city);
  assert.ok(city.paths.every(Boolean));assert.ok(city.remaining>0);
  city.toggle();run(city,120);
  assert.equal(city.state,'won');assert.ok(city.delivered>=TARGET);
  assert.equal(city.commuteTimes.length,city.delivered);assert.equal(city.arrivals.length,city.delivered);
  assert.ok(city.arrivals.every(event=>Number.isInteger(event.goal)&&Number.isInteger(event.goalIndex)));
  assert.ok(city.commuteTimes.every(time=>time>0));
  assert.ok(city.byRoute.every(n=>n>0));assert.ok(city.elapsed<=120);
});
test('pause freezes vehicles, demand and time; resume continues', () => {
  const city = new City();connect(city);city.toggle();run(city,3);city.toggle();
  const snapshot=JSON.stringify(city);run(city,10);assert.equal(JSON.stringify(city),snapshot);
  city.toggle();run(city,1);assert.ok(city.elapsed>3);
});
test('unconnected city loses at the deadline and terminal states do not advance', () => {
  const city = new City();city.toggle();run(city,121);
  assert.equal(city.state,'lost');assert.equal(city.elapsed,city.level.duration);assert.equal(city.delivered,0);
  const snapshot=JSON.stringify(city);city.toggle();run(city,3);city.edit(key(1,1));
  assert.equal(JSON.stringify(city),snapshot);
});
test('disconnecting and reconnecting roads updates path availability', () => {
  const city=new City();connect(city);
  const path=[...city.paths[0]],mid=path[1];
  city.edit(mid,true);assert.equal(city.paths[0],null);
  city.connect(path[0],mid);city.connect(mid,path[2]);assert.ok(city.paths[0]);
});
test('operation locks every planning mutation while running or paused', () => {
  const city=new City();connect(city);
  const edge=city.serializeDesign().edges[0],before=city.serializeDesign();
  city.toggle();
  for(const mutate of [
    ()=>city.edit(key(0,0)),
    ()=>city.connect(edge[0],edge[1]),
    ()=>city.cut(edge[0],edge[1]),
    ()=>city.setSignal(edge[0],true,2),
    ()=>city.setRoadPolicy([edge[0]],'prefer'),
    ()=>city.createBusLine(),
    ()=>city.updateBusLine('line-1',{name:'锁定测试'}),
    ()=>city.deleteBusLine('line-1'),
    ()=>city.setBusRoute([]),
    ()=>city.appendBusRoute([]),
    ()=>city.trimBusRoute([]),
    ()=>city.setBusCount(2),
    ()=>city.setBusStop(city.homes[0].cell,false),
    ()=>city.transact([{type:'edit',cell:key(0,0),erase:false,grade:0}])
  ]) assert.equal(mutate(),'运营期间不能修改规划，请先停止运营');
  assert.equal(city.loadDesign(before),'运营期间不能读取设计，请先停止运营');
  assert.deepEqual(city.serializeDesign(),before);
  city.toggle();assert.equal(city.state,'paused');
  assert.equal(city.edit(key(0,0)),'运营期间不能修改规划，请先停止运营');
  assert.deepEqual(city.serializeDesign(),before);
});
test('stopping operation keeps the design and resets all simulation progress', () => {
  const city=new City();connect(city);city.edit(key(5,3),false,2);city.toggle();run(city,3);city.toggle();
  const design=city.serializeDesign();
  assert.equal(city.stop(),true);assert.equal(city.state,'planning');assert.equal(city.elapsed,0);
  assert.equal(city.delivered,0);assert.equal(city.cars.length,0);assert.ok(city.queues.every(n=>n===0));
  assert.deepEqual(city.commuteTimes,[]);assert.deepEqual(city.arrivals,[]);
  assert.deepEqual(city.serializeDesign(),design);assert.equal(city.stop(),false);
});
test('designs round-trip with road grades and signals while invalid data is atomic', () => {
  const source=new City();connect(source);
  const path=[...source.paths[0]],junction=path[1];
  source.edit(path[2],false,2);assert.equal(source.setRoadPolicy([path[2]],'prefer'),'');
  source.connect(junction,key(point(junction).x,point(junction).y-1));
  assert.equal(source.setSignal(junction,{enabled:true,green:6,automatic:false,yieldMode:'priority',priority:['west','south','east','north'],phases:[['north-straight'],['west-left','east-left']]}),'');
  const design=source.serializeDesign(), target=new City();target.edit(key(1,1));target.toggle();run(target,1);target.stop();
  assert.equal(design.version,8);assert.equal(target.loadDesign(JSON.parse(JSON.stringify(design))),'');
  assert.deepEqual(target.serializeDesign(),design);assert.equal(target.state,'planning');assert.equal(target.elapsed,0);
  const legacy=JSON.parse(JSON.stringify(design));legacy.version=5;
  for(const signal of legacy.signals)for(const field of ['automatic','yieldMode','priority','phases'])delete signal[field];
  const migrated=new City();assert.equal(migrated.loadDesign(legacy),'');
  assert.equal(migrated.signals.get(junction).automatic,true);assert.equal(migrated.signals.get(junction).yieldMode,'arrival');
  const conflicting=JSON.parse(JSON.stringify(design));conflicting.signals.find(signal=>signal.cell===junction).phases=[['north-straight','west-straight']];
  assert.equal(target.loadDesign(conflicting),'');assert.deepEqual(target.serializeDesign(),conflicting,'editable signal conflicts survive save/load');
  const before=target.serializeDesign(),malformed=JSON.parse(JSON.stringify(conflicting));malformed.signals.find(signal=>signal.cell===junction).phases=[[]];
  assert.ok(target.loadDesign(malformed));assert.deepEqual(target.serializeDesign(),before);
  assert.ok(target.loadDesign({...design,roads:[...design.roads,{cell:-1,grade:0}]}));
  assert.deepEqual(target.serializeDesign(),before);
  assert.ok(target.loadDesign({...design,levelId:'rush-hour'}));
});

test('levels can define independent map dimensions', () => {
  const builtIn=require('../src/shared/level-catalog.js').loadCatalogSync(require('node:path').join(__dirname,'..','built-in-levels.json'));
  const level={id:'wide-map',name:'宽图',english:'WIDE',difficulty:'测试',title:'动态地图',description:'测试',tip:'测试',lesson:'测试',width:20,height:10,budget:20,duration:10,features:{grade:true,load:true,cut:true,inspect:true,signals:true,bus:false},water:[],bridges:[],trees:[],routes:[{name:'路线',color:'#638d69',light:'#dae6cb',homes:[{cell:0,generationRate:1,passengers:1}],goals:[{cell:19,label:'终点'}]}],initialEdges:[]};
  try {
    assert.equal(require('../src/shared/core.js').setLevels({version:1,chapters:[{id:'dynamic',name:'动态',english:'DYNAMIC',levels:[level]}]}),'');
    const city=new City('wide-map');assert.equal(city.width,20);assert.equal(city.height,10);assert.equal(city.target,1);
    assert.deepEqual(city.point(city.key(19,9)),{x:19,y:9});assert.ok(!city.neighbors(19).includes(20));
    assert.equal(city.connect(19,39),'');assert.ok(city.edges.get(19).has(39));
  } finally { require('../src/shared/core.js').setLevels(builtIn); }
});
