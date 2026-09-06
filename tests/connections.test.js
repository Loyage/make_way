'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {City,key,WIDTH}=require('../core.js');
function plain(){const c=new City('neighborhood');c.water.clear();c.trees.clear();c.bridges.clear();c.roads.clear();c.edges.clear();return c;}
function cross(){const c=plain(),n=key(6,5);c.routes=[{home:key(3,5),goal:key(9,5)},{home:key(6,2),goal:key(6,8)}];c.buildings=new Set(c.routes.flatMap(r=>[r.home,r.goal]));c.queues=[0,0];c.spawnTimers=[100,100];c.byRoute=[0,0];for(let x=3;x<9;x++)c.connect(key(x,5),key(x+1,5));for(let y=2;y<8;y++)c.connect(key(6,y),key(6,y+1));return {c,n};}
function car(cell,route,id){const h=route?WIDTH:1;return {cell,route,id,next:null,heading:h,cellHeading:h,cellLane:0,cellSlot:1,progress:0,blocked:0};}
test('neighboring surfaces stay disconnected until an explicit stroke joins them',()=>{
 const c=plain();for(let x=3;x<7;x++){c.connect(key(x,4),key(x+1,4));c.connect(key(x,5),key(x+1,5));}
 assert.equal(c.links(key(5,4)).includes(key(5,5)),false);assert.equal(c.signals.size,0);
 c.connect(key(5,4),key(5,5));assert.equal(c.signals.size,2);assert.equal(c.signals.get(key(5,4)).enabled,false);
});
test('building connections are explicit and scissors preserve costs and surfaces',()=>{
 const c=new City('neighborhood');for(let x=3;x<10;x++)c.connect(key(x,3),key(x+1,3));assert.equal(c.paths[0],null);
 c.connect(key(2,3),key(3,3));c.connect(key(10,3),key(11,3));assert.ok(c.paths[0]);const cost=c.remaining;
 c.cut(key(6,3),key(7,3));assert.equal(c.paths[0],null);assert.equal(c.remaining,cost);assert.ok(c.roads.has(key(6,3))&&c.roads.has(key(7,3)));
 c.connect(key(6,3),key(7,3));assert.ok(c.paths[0]);assert.equal(c.remaining,cost);
});
test('invalid and unaffordable connections are atomic and never wrap edges',()=>{
 const c=plain(),before=c.serializeDesign();assert.ok(c.connect(15,16));assert.deepEqual(c.serializeDesign(),before);
 c.trees.add(key(4,4));assert.ok(c.connect(key(3,4),key(4,4)));assert.deepEqual(c.serializeDesign(),before);
 c.level={...c.level,budget:1};assert.ok(c.connect(key(5,4),key(6,4)));assert.deepEqual(c.serializeDesign(),before);
});
test('scissors protect crossings and committed exits; cuts can be saved and restored',()=>{
 const {c,n}=cross(),a=car(n-1,0,1);c.cars=[a];c.toggle();c.step(.05);
 assert.equal(a.next,n);assert.ok(c.cut(n-1,n));assert.ok(c.cut(n,n+1));assert.ok(c.setSignal(n,true));
 c.stop();c.cut(n,n+1);const saved=c.serializeDesign();assert.equal(saved.version,2);
 // Roundtrip on a real level, including a disconnected surface.
 const real=new City();real.connect(key(4,3),key(5,3));real.cut(key(4,3),key(5,3));const target=new City();
 assert.equal(target.loadDesign(real.serializeDesign()),'');assert.deepEqual(target.serializeDesign(),real.serializeDesign());
 const invalid={...real.serializeDesign(),edges:[[15,16]]};const previous=target.serializeDesign();assert.ok(target.loadDesign(invalid));assert.deepEqual(target.serializeDesign(),previous);
});
test('legacy v1 designs migrate adjacency and keep original signal choices',()=>{
 const c=new City('neighborhood'),old={version:1,levelId:'neighborhood',roads:[3,4,5].map(x=>({cell:key(x,3),grade:0})),signals:[]};
 assert.equal(c.loadDesign(old),'');assert.ok(c.links(key(3,3)).includes(key(2,3)));assert.ok(c.links(key(4,3)).includes(key(5,3)));
});
test('yield intersections serialize opposing movements and strongly reward signals',()=>{
 const slow=cross(),fast=cross();fast.c.setSignal(fast.n,true);
 const a=car(slow.n-1,0,1),b=car(fast.n-1,0,1);slow.c.cars=[a];fast.c.cars=[b];
 slow.c.toggle();fast.c.toggle();slow.c.step(.05);fast.c.step(.05);
 assert.equal(a.next,slow.n);assert.equal(b.next,fast.n);assert.ok(Math.abs(a.progress/0.35-b.progress)<1e-10);
 assert.equal(slow.c.available(slow.n,-1),false);assert.equal(slow.c.load(slow.n).capacity,1);
});
test('yield order follows arrival time, not route direction or car creation time',()=>{
 const {c,n}=cross(),block=car(n,0,99),first=car(n-WIDTH,1,8),later=car(n-1,0,1);
 block.cellMovement={exitCell:n+1,entry:1,exit:1,turn:'straight',mask:12};c.cars=[block,first];c.toggle();c.step(.05);
 c.cars.push(later);c.step(.05);assert.ok(first.yieldSince<later.yieldSince);
 c.cars=[later,first];c.step(.05);assert.equal(first.next,n);assert.equal(later.next,null);
});
