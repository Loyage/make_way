'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { City, ROAD_TYPES, WIDTH, key, movement, movementsConflict, VEHICLE_WIDTH, VEHICLE_LENGTH, LANE_WIDTH } = require('../src/shared/core.js');

function street() {
  const city = new City('neighborhood');
  city.water.clear(); city.trees.clear(); city.bridges.clear(); city.roads.clear();
  city.setRoutes([{ name: 'test', color: '#638d69', light: '#dae6cb', homes: [{ cell: key(1,5), rate: 1, passengers: 0 }], goals: [{ cell: key(9,5), label: '工坊' }] }]);
  city.deadlineMode=true;
  for(let x=1;x<9;x++) assert.equal(city.connect(key(x,5),key(x+1,5)),'');
  return city;
}
function car(cell, heading=1, lane=0, next=null, slot=1) {
  return { id:1,route:0,cell,next,heading,cellHeading:heading,lane,cellLane:lane,cellSlot:slot,nextSlot:0,progress:0,blocked:0 };
}
function cross() {
  const city=street(),n=key(5,5);
  for(let y=3;y<=7;y++)city.edit(key(5,y));
  city.setRoutes([
    { name: 'a', color: '#638d69', light: '#dae6cb', homes: [{ cell: key(1,5), rate: 1, passengers: 0 }], goals: [{ cell: key(9,5), label: '工坊' }] },
    { name: 'b', color: '#d19157', light: '#f2dfbf', homes: [{ cell: key(5,2), rate: 1, passengers: 0 }], goals: [{ cell: key(5,8), label: '市场' }] }
  ]);
  for(let y=2;y<8;y++)city.connect(key(5,y),key(5,y+1));
  city.setSignal(n,true);
  return {city,n};
}
test('three road grades charge differences, refund full cost, and reset independently',()=>{
  const city=street(),n=key(4,5),remaining=city.remaining;
  assert.equal(ROAD_TYPES.length,3);assert.equal(city.edit(n,false,2),'');assert.equal(city.remaining,remaining-2);
  city.edit(n,false,2);assert.equal(city.remaining,remaining-2);
  city.edit(n,false,1);assert.equal(city.remaining,remaining-1);
  city.edit(n,true);assert.equal(city.remaining,remaining+1);assert.equal(city.roadGrades.has(n),false);
  city.edit(n,false,2);assert.equal(city.remaining,remaining-2);
  assert.equal(street().roadType(n),ROAD_TYPES[0]);
});
test('insufficient budget and invalid grade cannot partly change the network',()=>{
  const city=street(),n=key(4,5);
  for(let i=0;i<192;i++)city.edit(i);
  const before=city.remaining;assert.ok(city.edit(n,false,2));assert.equal(city.remaining,before);assert.equal(city.roadType(n),ROAD_TYPES[0]);
  assert.ok(city.edit(n,false,3));assert.ok(city.edit(n,false,-1));assert.ok(city.edit(n,false,NaN));
});
test('bridges are buildable terrain and may remain empty',()=>{
  const city=new City('rush-hour'),n=[...city.bridges][0];
  assert.equal(city.roads.has(n),false);
  assert.equal(city.edit(n,false,2),'');assert.equal(city.remaining,city.level.budget-3);
  assert.equal(city.edit(n,true),'');assert.equal(city.roads.has(n),false);
  assert.equal(city.remaining,city.level.budget);
});
test('capacity counts occupants and incoming reservations per direction, excludes self',()=>{
  const city=street(),n=key(4,5);city.edit(n,false,2);
  city.cars=[car(n,1,0),car(n,1,1),car(n,1,2),car(n,1,0,null,0),car(n,1,1,null,0),car(n-1,1,2,n)];
  assert.equal(city.available(n,1),false);assert.equal(city.available(n,-1),true);
  assert.equal(city.available(n,1,city.cars[3]),true);
  assert.deepEqual(city.load(n),{used:6,capacity:6,total:6,ratio:1});
  city.cars.pop();assert.equal(city.laneFor(n,1),2);
});
test('turning preserves the source reservation heading until the vehicle leaves',()=>{
  const city=street(),n=key(4,5),c=car(n);
  c.heading=WIDTH;c.next=n+WIDTH;city.cars=[c];
  assert.equal(city.laneFor(n,1,undefined,1),-1);assert.equal(city.available(n+WIDTH,WIDTH),false);
});
test('occupied or reserved roads cannot be downgraded or demolished, upgrades remain safe',()=>{
  const city=street(),n=key(4,5);city.edit(n,false,1);city.cars=[car(n-1,1,0,n)];
  assert.ok(city.edit(n,false,0));assert.ok(city.edit(n,true));assert.equal(city.roadType(n),ROAD_TYPES[1]);
  assert.equal(city.edit(n,false,2),'');assert.equal(city.roadType(n),ROAD_TYPES[2]);
});
test('private cars choose free-flow travel time and honor road guidance',()=>{
  const city=street(),home=key(1,5),goal=key(9,5);city.runtimeBudget=100;
  for(let x=1;x<=9;x++)city.edit(key(x,4),false,2);
  city.connect(home,key(1,4),2);for(let x=1;x<9;x++)city.connect(key(x,4),key(x+1,4),2);city.connect(key(9,4),goal,2);
  assert.equal(city.bestGoalPath(0).path[1],key(1,4),'longer fast road should beat the short slow road');
  const fastCells=Array.from({length:9},(_,i)=>key(i+1,4));assert.equal(city.setRoadPolicy(fastCells,'avoid'),'');
  assert.equal(city.bestGoalPath(0).path[1],key(2,5),'car bans should force the alternative while preserving roads');
  assert.equal(city.setRoadPolicy(fastCells,null),'');assert.equal(city.setRoadPolicy([key(2,5)],'prefer'),'');
  const design=city.serializeDesign();assert.deepEqual(design.roadPolicies,[{cell:key(2,5),policy:'prefer'}]);
});
test('faster road grades actually improve vehicle travel speed',()=>{
  const slow=street(),fast=street();
  for(const n of fast.roads)fast.edit(n,false,2);
  for(const city of [slow,fast]){city.cars=[car(key(3,5))];city.toggle();for(let i=0;i<10;i++)city.step(.05);}
  const position=city=>city.cars[0].cell+city.cars[0].progress;
  assert.ok(position(fast)>position(slow));
});
test('full downstream road causes waiting; releasing space restores flow',()=>{
  const city=street(),n=key(4,5),first=car(n-1);
  // Block the entire downstream chain, then leave only the first waiting car.
  city.cars=[first,...Array.from({length:5},(_,i)=>[car(n+i),car(n+i,1,0,null,0)]).flat()];city.toggle();city.step(.05);
  assert.equal(first.next,null);assert.ok(first.blocked>0);
  city.cars=[first];city.step(.05);assert.equal(first.next,n);assert.equal(first.blocked,0);
});
test('junctions are automatically added/removed and surviving signal settings persist',()=>{
  const city=street(),n=key(5,5);
  assert.equal(city.signals.has(n),false);city.connect(n,n-WIDTH);assert.equal(city.signals.has(n),true);
  const defaults={enabled:false,green:2,yieldMode:'arrival',priority:['north','east','south','west'],automatic:true,phases:[['west-straight','east-straight'],['west-left','east-left'],['north-straight','south-straight'],['north-left','south-left']]};
  assert.equal(city.setSignal(n,false,6),'');city.edit(key(2,4));assert.deepEqual(city.signals.get(n),{...defaults,green:6});
  city.edit(n-WIDTH,true);assert.equal(city.signals.has(n),false);
  city.connect(n,n-WIDTH);assert.deepEqual(city.signals.get(n),defaults);
  assert.ok(city.setSignal(n,true,0));assert.ok(city.setSignal(n,true,NaN));assert.ok(city.setSignal(0,true,2));
});
test('signal suggestions remain conflict-free and junction reports track each entrance',()=>{
  const {city,n}=cross(),phases=city.suggestSignalPhases(n);assert.ok(phases.length);
  assert.ok(phases.every(actions=>city.signalConflicts(actions).length===0));
  assert.ok(city.signalConflicts(['north-straight','west-straight']).length);
  const west=car(n-1);city.cars=[west];city.toggle();for(let i=0;i<30;i++)city.step(.05);
  const report=city.junctionReports().find(item=>item.cell===n);assert.ok(report);assert.ok(report.entries.west.maxQueue>=1);
});
test('junction control permits editing conflicts but blocks operation until custom phases are safe',()=>{
  const {city,n}=cross();
  assert.equal(city.setSignal(n,{enabled:false,yieldMode:'priority',priority:['north','east','south','west']}),'');
  const west=car(n-1);west.id=1;const north=car(n-WIDTH,WIDTH);north.id=2;north.route=1;city.cars=[west,north];
  city.toggle();city.step(.05);assert.equal(north.next,n);assert.equal(west.next,null,'higher-priority north entrance goes first');
  city.stop();
  assert.ok(city.setSignal(n,{priority:['north','north','south','west']}));
  assert.equal(city.setSignal(n,{enabled:true,automatic:false,phases:[['north-straight','west-straight']]}),'','conflicting combinations remain editable');
  const conflictIssue=city.preflightCheck().issues.find(issue=>issue.code==='signal-conflict');
  assert.equal(conflictIssue.blocking,true);assert.deepEqual(conflictIssue.cells,[n]);assert.match(conflictIssue.detail,/阶段 1/);
  assert.match(city.toggle(),/地图设计有问题/);assert.equal(city.state,'planning');
  assert.ok(city.setSignal(n,{automatic:false,phases:[]}));assert.ok(city.setSignal(n,{automatic:false,phases:Array.from({length:9},()=>['north-straight'])}));
  assert.equal(city.setSignal(n,{enabled:true,automatic:false,green:4,phases:[['north-straight'],['west-left','east-left']]}),'');
  city.elapsed=0;assert.equal(city.signalPhase(n).stage,'custom');assert.equal(city.canEnter(n,WIDTH,WIDTH),true);assert.equal(city.canEnter(n,1,1),false);
  city.elapsed=4.25;assert.equal(city.signalPhase(n).index,1);assert.equal(city.canEnter(n,1,-WIDTH),true);
  assert.equal(city.canEnter(n,1,WIDTH),true,'right turns continue to yield independently of the signal sequence');
});
test('green phases alternate with an all-red clearance and freeze while paused',()=>{
  const {city,n}=cross();
  for(const [time,stage] of [[0,'horizontal-straight'],[2,'clearance'],[2.25,'horizontal-left'],[4.25,'clearance'],[4.5,'vertical-straight'],[6.5,'clearance'],[6.75,'vertical-left'],[8.75,'clearance'],[9,'horizontal-straight']]){
    city.elapsed=time;assert.equal(city.signalPhase(n).stage,stage);
  }
  city.setSignal(n,true,4);city.elapsed=3;assert.equal(city.signalPhase(n).axis,'horizontal');
  const phase=city.signalPhase(n);city.state='paused';city.step(.1);assert.deepEqual(city.signalPhase(n),phase);
  assert.equal(city.setSignal(n,false,4),'运营期间不能修改规划，请先停止运营');
  assert.deepEqual(city.signalPhase(n),phase);
});
test('automatic T-junction signals use a main-road-first three-stage cycle',()=>{
  const {city,n}=cross();
  assert.equal(city.cut(n,n-WIDTH),'');
  city.elapsed=0;
  assert.deepEqual(city.signalPhase(n).actions,['west-straight','east-straight']);
  assert.equal(city.canEnter(n,1,1),true);assert.equal(city.canEnter(n,-1,WIDTH),false);
  city.elapsed=2.25;
  assert.equal(city.signalPhase(n).stage,'main-turn');assert.deepEqual(city.signalPhase(n).actions,['east-left']);
  assert.equal(city.canEnter(n,-1,WIDTH),true);assert.equal(city.canEnter(n,-WIDTH,-1),false);
  city.elapsed=4.5;
  assert.equal(city.signalPhase(n).stage,'branch-turn');assert.deepEqual(city.signalPhase(n).actions,['south-left']);
  assert.equal(city.canEnter(n,-WIDTH,-1),true);
  city.elapsed=6.75;assert.equal(city.signalPhase(n).stage,'main-straight');
});
test('red holds a vehicle upstream; green permits entry; phase changes never revoke reservations',()=>{
  const {city,n}=cross(),c=car(n-WIDTH,WIDTH);c.route=1;city.cars=[c];city.toggle();city.step(.05);
  assert.equal(c.next,null);assert.ok(c.blocked>0);
  city.elapsed=4.6;city.step(.05);assert.equal(c.next,n);
  assert.equal(city.available(n,1),false);
  city.elapsed=8.99;for(let i=0;i<5;i++)city.step(.05);
  assert.equal(c.cell,n);assert.equal(city.signalPhase(n).axis,'horizontal');
});
test('disabled lights still protect conflict quadrants; upgrades do not remove conflicts',()=>{
  const {city,n}=cross();city.edit(n,false,2);city.setSignal(n,false,2);city.cars=[car(n-1,1,0,n)];
  assert.equal(city.available(n,WIDTH),false);assert.equal(city.load(n).capacity,1);
});
test('higher road grades separate turning traffic into dedicated approach lanes',()=>{
  const results=[];
  for(const grade of [0,1,2]) {
    const {city,n}=cross(),approach=n-1;
    for(const cell of [n-2,approach,n,n+1,n+WIDTH])city.edit(cell,false,grade);
    assert.deepEqual(['left','straight','right'].map(turn=>city.turnLane(approach,turn)),grade===0?[0,0,0]:grade===1?[0,1,1]:[0,1,2]);
    const straight=car(approach,1,city.turnLane(approach,'straight'));straight.id=1;straight.goal=n+1;
    const right=car(n-2);right.id=2;right.goal=n+WIDTH;
    city.cars=[straight,right];city.elapsed=4.5;city.toggle();
    for(let i=0;i<20;i++)city.step(.05);
    results.push(right.cell===right.goal);
  }
  assert.deepEqual(results,[false,false,true],'only the three-lane approach lets right turns bypass a straight vehicle waiting at red');
});
test('blocked junction exits prevent box entry even during green',()=>{
  const {city,n}=cross(),c=car(n-1);city.cars=[c,car(n+1),car(n+1,1,0,null,0)];city.toggle();city.step(.05);
  assert.equal(c.next,null);assert.ok(c.blocked>0);
});
test('live construction cannot turn a multi-vehicle road into an overfull junction',()=>{
  const city=street(),n=key(5,5),budget=city.remaining;
  city.cars=[car(n,1),car(n,-1)];
  assert.ok(city.connect(n,n-WIDTH));assert.equal(city.roads.has(n-WIDTH),false);assert.equal(city.remaining,budget);
  city.cars.pop();assert.ok(city.connect(n,n-WIDTH));
  city.cars=[];assert.equal(city.connect(n,n-WIDTH),'');assert.equal(city.signals.has(n),true);
  assert.equal(city.load(n).used,0);
});
test('all approaches distinguish right, straight and left through all four phases',()=>{
  const {city,n}=cross(),right={1:WIDTH,[WIDTH]:-1,[-1]:-WIDTH,[-WIDTH]:1};
  for(const entry of [1,WIDTH,-1,-WIDTH]) {
    assert.equal(movement(entry,right[entry]).turn,'right');
    assert.equal(movement(entry,-right[entry]).turn,'left');
    for(const time of [0,2.1,2.3,4.4,4.6,6.6,6.9,8.9]) {
      city.elapsed=time;const phase=city.signalPhase(n);
      assert.equal(city.canEnter(n,entry,right[entry]),true);
      const axis=Math.abs(entry)===1?'horizontal':'vertical';
      assert.equal(city.canEnter(n,entry),phase.axis===axis&&phase.turn==='straight');
      assert.equal(city.canEnter(n,entry,-right[entry]),phase.axis===axis&&phase.turn==='left');
    }
  }
});
test('compatible opposing movements and four right turns can share a junction',()=>{
  const {city,n}=cross();
  assert.equal(movementsConflict(movement(1,1),movement(-1,-1)),false);
  assert.equal(movementsConflict(movement(1,-WIDTH),movement(-1,WIDTH)),false);
  assert.equal(movementsConflict(movement(1,1),movement(WIDTH,WIDTH)),true);
  const turns=[[1,WIDTH],[WIDTH,-1],[-1,-WIDTH],[-WIDTH,1]];
  for(const [entry,exit] of turns) {
    const move=movement(entry,exit);
    assert.equal(city.junctionAvailable(n,move),true);
    const c=car(n-entry,entry,0,n);c.nextMovement=move;city.cars.push(c);
  }
  assert.equal(city.load(n).total,4);
  assert.equal(city.junctionAvailable(n,movement(1,1)),false);
});
test('right turns move on red, but yield to conflicting vehicles and full exits',()=>{
  const {city,n}=cross();
  city.routes[0].goals[0].cell=key(5,8);city.rebuildRoutes();
  const c=car(n-1);city.cars=[c];city.elapsed=4.5;city.toggle();city.step(.05);
  assert.equal(c.next,n);assert.equal(c.nextMovement.turn,'right');
  assert.ok(city.edit(n+WIDTH,true),'committed exit must not be demolished');
  const blocked=cross();blocked.city.routes[0].goals[0].cell=key(5,8);blocked.city.rebuildRoutes();
  const waiting=car(blocked.n-1),other=car(blocked.n,WIDTH);
  other.cellMovement=movement(WIDTH,WIDTH);blocked.city.cars=[waiting,other];
  blocked.city.toggle();blocked.city.step(.05);assert.equal(waiting.next,null);
  const full=cross();full.city.routes[0].goals[0].cell=key(5,8);full.city.rebuildRoutes();
  const w=car(full.n-1);full.city.cars=[w,car(full.n+WIDTH,WIDTH,0,null,0),car(full.n+WIDTH,WIDTH)];
  full.city.toggle();full.city.step(.05);assert.equal(w.next,null);
});
test('right turns yield to newly eligible straight traffic regardless of creation order',()=>{
  const {city,n}=cross();city.routes[0].goals[0].cell=key(5,8);city.rebuildRoutes();
  const right=car(n-1),straight=car(n-WIDTH,WIDTH);straight.route=1;
  city.cars=[right,straight];city.elapsed=4.5;city.toggle();city.step(.05);
  assert.equal(straight.next,n);assert.equal(right.next,null);
});
test('simultaneous right turns render around separate corners, not on top of the center',()=>{
  const {city,n}=cross();
  const poses=[[1,WIDTH],[WIDTH,-1],[-1,-WIDTH],[-WIDTH,1]].map(([entry,exit])=>{
    const c=car(n,entry);c.cellMovement=movement(entry,exit);return city.pose(c);
  });
  for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++) {
    assert.ok(Math.hypot(poses[i].x-poses[j].x,poses[i].y-poses[j].y)>VEHICLE_LENGTH);
  }
});
test('each lane has distinct front/rear positions, with uniform vehicle dimensions',()=>{
  assert.ok(VEHICLE_WIDTH<LANE_WIDTH);assert.ok(VEHICLE_LENGTH<.5);
  const city=street(),n=key(4,5);
  for(let grade=0;grade<3;grade++) {
    city.cars=[];city.edit(n,false,grade);
    const type=city.roadType(n);assert.equal(type.capacity,type.lanes*2);
    if(grade)assert.ok(type.width>ROAD_TYPES[grade-1].width);
    for(let lane=0;lane<type.lanes;lane++) {
      const front=car(n,1,lane),rear=car(n,1,lane,null,0);
      const a=city.pose(front),b=city.pose(rear);
      assert.equal(a.y,b.y);assert.equal(a.x-b.x,.5);
      assert.ok((lane+.5)*LANE_WIDTH+VEHICLE_WIDTH/2<type.width/2);
      city.cars.push(front,rear);
    }
    assert.equal(city.available(n,1),false);
    assert.equal(city.load(n).used,type.capacity);
  }
});
test('rear vehicle cannot pass a stopped front vehicle, then advances into the front slot',()=>{
  const city=street(),n=key(4,5),front=car(n),rear=car(n,1,0,null,0);
  city.cars=[rear,front];city.toggle();city.step(.05);
  assert.equal(rear.next,null);assert.ok(rear.blocked>0);
  city.cars=[rear];city.step(.05);
  assert.equal(rear.next,n);assert.equal(rear.nextSlot,1);
  assert.equal(city.available(n,1),false,'rear slot remains reserved during advancement');
  for(let i=0;i<3;i++)city.step(.05);
  assert.equal(rear.cellSlot,1);assert.equal(city.available(n,1),true);
});
