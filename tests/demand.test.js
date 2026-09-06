'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {City,LEVELS,key}=require('../core.js');
const {buildReferencePlan,completeCrossing,line}=require('./reference-plan.cjs');
function run(c){c.toggle();for(let i=0;i<=c.level.duration*20;i++)c.step(.05);}

test('finite demand is visible before starting and respects each building rate',()=>{
  for(const level of LEVELS){
    const c=new City(level.id);c.edges.clear();c.refreshPaths();
    for(const r of c.routes){assert.ok([1,4,6].includes(r.rate));assert.ok(Number.isInteger(r.passengers)&&r.passengers>0);assert.ok(r.passengers/r.rate<=level.duration);}
    assert.ok(level.target<=c.routes.reduce((sum,r)=>sum+r.passengers,0));
    assert.deepEqual(c.generated,c.routes.map(()=>0));
    c.toggle();for(let i=0;i<200;i++)c.step(.05);
    assert.deepEqual(c.generated,c.routes.map(r=>Math.min(r.passengers,10*r.rate)));
    const snapshot=[...c.generated];c.toggle();c.step(.05);assert.deepEqual(c.generated,snapshot);c.toggle();
    for(let i=0;i<3000;i++)c.step(.05);
    assert.deepEqual(c.queues,c.routes.map(r=>r.passengers));
    c.resetOperation();assert.deepEqual(c.generated,c.routes.map(()=>0));
  }
});
function straight(grade,rate,seconds=120) {
  const c=new City('neighborhood');c.trees.clear();
  c.routes=[{...c.routes[0],home:key(1,5),goal:key(14,5),rate,passengers:rate*seconds}];
  c.buildings=new Set(c.routes.flatMap(r=>[r.home,r.goal]));
  c.level={...c.level,budget:100,duration:seconds,target:rate*seconds+1};
  c.resetOperation();line(c,1,5,14,5,grade);return c;
}
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
    const c=straight(grade,rate,65);c.routes[0].passengers=rate*55;run(c);
    assert.equal(c.delivered,rate*55);
    if(grade>0) {
      const lower=straight(grade-1,rate,65);lower.routes[0].passengers=rate*55;run(lower);
      assert.ok(lower.delivered<rate*55);assert.ok(lower.queues[0]>0);
    }
  }
});
for(const id of ['demolition-school','avenue-school','signal-school'])test(`${id}: the taught intervention turns a losing plan into a win`,()=>{
  const before=new City(id),after=new City(id);
  if(id==='signal-school')completeCrossing(before);
  buildReferencePlan(after);
  for(const c of [before,after])run(c);
  assert.equal(before.state,'lost');assert.equal(after.state,'won');assert.ok(after.delivered>before.delivered);assert.ok(after.remaining>=0);
});
test('demolition refunds a spent budget and rebuilding cannot be skipped',()=>{
  const c=new City('demolition-school');assert.equal(c.remaining,0);
  assert.ok(c.connect(key(2,2),key(2,3)));
  assert.equal(c.edit(key(13,5),true),'');assert.equal(c.remaining,1);assert.equal(c.paths[0],null);
  const saved=c.serializeDesign(),other=new City(c.level.id);assert.equal(other.loadDesign(saved),'');
  assert.deepEqual(other.serializeDesign(),saved);assert.equal(other.roads.has(key(13,5)),false);
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
  completeCrossing(c);assert.equal(c.signals.size,4);assert.ok(c.paths.every(Boolean));
  const path=c.paths[3];assert.ok(path.some((n,i)=>i>1&&n-path[i-1]!==path[i-1]-path[i-2]));
  c.setSignal(key(5,4),true,4);run(c);assert.equal(c.state,'lost','one lamp must not solve the whole map');
});
