'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {City,LEVELS,key}=require('../src/shared/core.js');
const {buildReferencePlan,completeCrossing,line}=require('./reference-plan.cjs');
function run(c){c.toggle();for(let i=0;i<=c.level.duration*20;i++)c.step(.05);}

test('multi-home / multi-goal routes annotate each node and prefer the nearest reachable goal',()=>{
  const c=new City('neighborhood');c.water.clear();c.trees.clear();c.bridges.clear();c.roads.clear();
  c.setRoutes([{
    name:'双住宅 → 双目的地', color:'#638d69', light:'#dae6cb',
    homes:[{cell:key(1,3),generationRate:3,passengers:30},{cell:key(1,5),generationRate:4,passengers:60}],
    goals:[{cell:key(7,3),label:'工坊'},{cell:key(7,5),label:'市场'}]
  }]);
  assert.equal(c.homes.length,2);assert.equal(c.goals.length,2);
  assert.equal(c.generated.length,2);assert.equal(c.byRoute.length,1);assert.equal(c.byGoal.length,2);
  assert.equal(c.homes[0].passengers,30);assert.equal(c.homes[0].generationRate,3);assert.equal(c.homes[1].generationRate,4);
  assert.equal(c.goals[0].label,'工坊');assert.equal(c.goals[1].label,'市场');
  line(c,1,3,7,3,0);line(c,1,5,7,5,0);line(c,7,3,7,5,0);
  assert.deepEqual(c.homeGoal,[0,1],'each home prefers its own nearest reachable goal');
  assert.ok(c.routeConnected(0));
});

test('legacy home rates migrate to generationRate and obsolete carRate is ignored',()=>{
  const c=new City('neighborhood');
  c.setRoutes([{name:'旧路线',color:'#638d69',light:'#dae6cb',homes:[{cell:key(1,3),rate:4,carRate:.01,passengers:20}],goals:[{cell:key(7,3),label:'工坊'}]}]);
  assert.equal(c.homes[0].generationRate,4);
  assert.equal('rate' in c.routes[0].homes[0],false);
  assert.equal('carRate' in c.routes[0].homes[0],false);
});

test('a full goal (input cap reached) is skipped for later home->goal assignment',()=>{
  const c=new City('neighborhood');c.water.clear();c.trees.clear();c.bridges.clear();c.roads.clear();
  c.setRoutes([{
    name:'多目的地', color:'#638d69', light:'#dae6cb',
    homes:[{cell:key(1,3),rate:1,passengers:100}],
    goals:[{cell:key(5,1),label:'工坊',input:10},{cell:key(9,3),label:'市场'}]
  }]);
  line(c,1,3,5,3,0);line(c,5,3,5,1,0);line(c,5,3,9,3,0);
  assert.equal(c.homeGoal[0],0);
  c.goalAssigned[0]=10;c.refreshPaths();
  assert.equal(c.homeGoal[0],1,'full goal must not be selected for new spawns');
});

test('input caps spread demand across destinations even when spawn outpaces delivery',()=>{
  const c=new City('neighborhood');c.water.clear();c.trees.clear();c.bridges.clear();c.roads.clear();
  c.setRoutes([{
    name:'多目的地', color:'#638d69', light:'#dae6cb',
    homes:[{cell:key(1,3),rate:10,passengers:60}],
    goals:[{cell:key(5,1),label:'工坊',input:20},{cell:key(9,3),label:'市场'}]
  }]);
  line(c,1,3,5,3,0);line(c,5,3,5,1,0);line(c,5,3,9,3,0);
  c.level={...c.level,duration:60};
  c.toggle();for(let i=0;i<1200;i++)c.step(.05);
  assert.ok(c.goalAssigned[0]<=20,'first goal is capped at its input');
  assert.ok(c.goalAssigned[1]>0,'overflow is assigned to the next reachable goal');
});

test('finite demand is visible before starting and respects each building rate',()=>{
  for(const level of LEVELS){
    const c=new City(level.id);c.edges.clear();c.refreshPaths();
    for(const h of c.homes){assert.ok([1,4,6].includes(h.generationRate));assert.ok(Number.isInteger(h.passengers)&&h.passengers>0);assert.ok(h.passengers/h.generationRate<=level.duration);}
    assert.equal(c.target,c.homes.reduce((sum,h)=>sum+h.passengers,0));
    assert.deepEqual(c.generated,c.homes.map(()=>0));
    c.toggle();for(let i=0;i<200;i++)c.step(.05);
    assert.deepEqual(c.generated,c.homes.map(h=>Math.min(h.passengers,10*h.generationRate)));
    const snapshot=[...c.generated];c.toggle();c.step(.05);assert.deepEqual(c.generated,snapshot);c.toggle();
    for(let i=0;i<3000;i++)c.step(.05);
    assert.deepEqual(c.queues,c.homes.map(h=>h.passengers));
    c.resetOperation();assert.deepEqual(c.generated,c.homes.map(()=>0));
  }
});
function straight(grade,rate,seconds=120) {
  const c=new City('neighborhood');c.trees.clear();
  c.setRoutes([{ name:'test', color:'#638d69', light:'#dae6cb', homes:[{cell:key(1,5),rate,passengers:rate*seconds}], goals:[{cell:key(14,5),label:'工坊'}] }]);
  c.level={...c.level,budget:100,duration:seconds};
  c.resetOperation();line(c,1,5,14,5,grade);return c;
}
test('private-car departure depends on the doorway road grade, not carRate metadata',()=>{
  const departures=[];
  for(const grade of [0,1,2]) {
    const counts=[];
    for(const carRate of [.01,1000]) {
      const c=straight(grade,50,20);c.routes[0].homes[0].carRate=carRate;c.rebuildRoutes();c.toggle();
      for(let i=0;i<100;i++)c.step(.05);
      counts.push(c.departedByHome[0]);
    }
    assert.equal(counts[0],counts[1]);departures.push(counts[0]);
  }
  assert.ok(departures[0]<departures[1]&&departures[1]<departures[2]);
});
test('large custom demand rates generate every due passenger even with coarse steps',()=>{
  const c=straight(0,50,2);c.edges.clear();c.refreshPaths();c.toggle();
  for(let i=0;i<10;i++)c.step(.1);
  assert.equal(c.generated[0],50);assert.equal(c.queues[0],50);
});
test('saturated straight roads sustain about 2 / 5 / 6.67 people per second',()=>{
  for(const [grade,expected] of [[0,2],[1,5],[2,20/3]]) {
    const c=straight(grade,10);c.toggle();
    for(let i=0;i<600;i++)c.step(.05);
    const warm=c.delivered;
    for(let i=0;i<1800;i++)c.step(.05);
    assert.ok(Math.abs((c.delivered-warm)/90-expected)<.05);
    assert.ok(c.queues[0]>0);
  }
});
test('housing demand matches road grades, not merely the length of a detour',()=>{
  for(const [rate,grade] of [[1,0],[4,1],[6,2]]) {
    const c=straight(grade,rate,65);c.routes[0].homes[0].passengers=rate*55;c.rebuildRoutes();run(c);
    assert.equal(c.delivered,rate*55);
    if(grade>0) {
      const lower=straight(grade-1,rate,65);lower.routes[0].homes[0].passengers=rate*55;lower.rebuildRoutes();run(lower);
      assert.ok(lower.delivered<rate*55);assert.ok(lower.queues[0]>0);
    }
  }
});
for(const id of ['demolition-school','avenue-school','cut-school'])test(`${id}: the taught intervention turns a losing plan into a win`,()=>{
  const before=new City(id),after=new City(id);
  buildReferencePlan(after);
  for(const c of [before,after])run(c);
  if(id==='demolition-school')assert.ok(after.remaining>before.remaining,'the rebuild should refund enough budget for a cheaper route');
  else {assert.equal(before.state,'lost');assert.ok(after.delivered>before.delivered);}
  assert.equal(after.state,'won');assert.ok(after.remaining>=0);
});
test('woodland starts with a complete high-grade ring and only needs feeders',()=>{
  const c=new City('woodland'),ring=[...c.roads];
  assert.ok(c.paths.every(p=>p===null));
  for(const n of ring){assert.equal(c.roadGrades.get(n),2);assert.equal(c.links(n).length,2);}
  const visited=new Set(),pending=[ring[0]];
  while(pending.length){const n=pending.pop();if(visited.has(n))continue;visited.add(n);pending.push(...c.links(n));}
  assert.equal(visited.size,ring.length);
  buildReferencePlan(c);
  for(const n of ring)assert.equal(c.roadGrades.get(n),2);
  assert.ok(c.paths.every(p=>p.some(n=>ring.includes(n))));
  assert.ok([...c.signals.values()].every(s=>!s.enabled));run(c);assert.equal(c.state,'won');
});
test('crossing lesson requires completion and coordinates multiple junctions and turns',()=>{
  const c=new City('signal-school');assert.equal(c.paths.filter(Boolean).length,2);
  completeCrossing(c);assert.equal(c.signals.size,6);assert.ok(c.paths.every(Boolean));
  const path=c.paths[4];assert.ok(path.some((n,i)=>i>1&&n-path[i-1]!==path[i-1]-path[i-2]));
});
