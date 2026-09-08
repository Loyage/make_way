'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { City, WIDTH, HEIGHT, BUDGET, TARGET, ROUTES, key, point, neighbors, findPath } = require('../core.js');
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
test('a starter plan connects all routes and wins within the time limit', () => {
  const city = new City();connect(city);
  assert.ok(city.paths.every(Boolean));assert.ok(city.remaining>0);
  city.toggle();run(city,120);
  assert.equal(city.state,'won');assert.ok(city.delivered>=TARGET);
  assert.equal(city.commuteTimes.length,city.delivered);assert.equal(city.arrivals.length,city.delivered);
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
  city.edit(key(5,3),true);assert.equal(city.paths[0],null);
  city.connect(key(4,3),key(5,3));city.connect(key(5,3),key(6,3));assert.ok(city.paths[0]);
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
  const source=new City();connect(source);source.edit(key(5,3),false,2);
  const junction=key(4,3);source.connect(junction,key(4,4));assert.equal(source.setSignal(junction,false,6),'');
  const design=source.serializeDesign(), target=new City();target.edit(key(1,1));target.toggle();run(target,1);target.stop();
  assert.equal(target.loadDesign(JSON.parse(JSON.stringify(design))),'');
  assert.deepEqual(target.serializeDesign(),design);assert.equal(target.state,'planning');assert.equal(target.elapsed,0);
  const before=target.serializeDesign();
  assert.ok(target.loadDesign({...design,roads:[...design.roads,{cell:-1,grade:0}]}));
  assert.deepEqual(target.serializeDesign(),before);
  assert.ok(target.loadDesign({...design,levelId:'rush-hour'}));
});
