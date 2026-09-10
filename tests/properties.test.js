'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { City, LEVELS, ROAD_TYPES } = require('../src/shared/core.js');

function random(seed) {
  let state=seed>>>0;
  return () => ((state=Math.imul(state,1664525)+1013904223>>>0)/0x100000000);
}
function integer(next,limit) { return Math.floor(next()*limit); }
function choose(next,items) { return items[integer(next,items.length)]; }
function edgePath(city,points) {
  const cells=[];
  for(let i=1;i<points.length;i++){
    let {x,y}=points[i-1];const target=points[i];
    if(!cells.length)cells.push(city.key(x,y));
    while(x!==target.x){x+=Math.sign(target.x-x);cells.push(city.key(x,y));}
    while(y!==target.y){y+=Math.sign(target.y-y);cells.push(city.key(x,y));}
  }
  return cells;
}
function assertDesignInvariants(city,context) {
  assert.ok(city.remaining>=0,`${context}: budget became negative`);
  assert.equal(city.remaining,city.budget-[...city.roads].reduce((sum,cell)=>sum+city.roadType(cell).cost,0),`${context}: budget accounting drifted`);
  for(const cell of city.roads){
    assert.ok(Number.isInteger(cell)&&cell>=0&&cell<city.width*city.height,`${context}: road outside map`);
    assert.ok(ROAD_TYPES[city.roadGrades.get(cell)||0],`${context}: invalid road grade`);
    assert.ok(!city.trees.has(cell),`${context}: road overlaps trees`);
    assert.ok(!city.water.has(cell)||city.bridges.has(cell),`${context}: road leaves bridge terrain`);
  }
  for(const [a,links] of city.edges)for(const b of links){
    assert.ok(city.neighbors(a).includes(b),`${context}: non-adjacent edge ${a}-${b}`);
    assert.ok(city.edges.get(b)?.has(a),`${context}: asymmetric edge ${a}-${b}`);
    assert.ok(city.roads.has(a)||city.buildings.has(a),`${context}: edge starts on empty terrain`);
    assert.ok(city.roads.has(b)||city.buildings.has(b),`${context}: edge ends on empty terrain`);
    assert.ok(!(city.buildings.has(a)&&city.buildings.has(b)),`${context}: edge directly joins buildings`);
  }
  for(const [cell] of city.roadPolicies)assert.ok(city.roads.has(cell),`${context}: road policy survived road removal`);
}
function assertSimulationInvariants(city,context) {
  const population=city.passengerBreakdown();
  assert.equal(population.total,population.ungenerated+population.waiting+population.carTransit+population.busTransit+population.arrived,`${context}: population is not conserved`);
  assert.equal(population.arrived,city.delivered,`${context}: delivered total drifted`);
  assert.equal(city.commuteTimes.length,city.delivered,`${context}: commute samples drifted`);
  assert.equal(city.arrivals.length,city.delivered,`${context}: arrival events drifted`);
  assert.equal(city.byRoute.reduce((sum,count)=>sum+count,0),city.delivered,`${context}: route deliveries drifted`);
  assert.equal(city.byGoal.reduce((sum,count)=>sum+count,0),city.delivered,`${context}: goal deliveries drifted`);
  city.homes.forEach((home,index)=>{
    assert.ok(city.generated[index]>=0&&city.generated[index]<=home.passengers,`${context}: generated demand outside bounds`);
    assert.ok(city.queues[index]>=0&&city.queues[index]<=city.generated[index],`${context}: home queue outside bounds`);
    assert.equal(city.generated[index],city.queues[index]+city.departedByHome[index],`${context}: home departures drifted`);
  });
  city.goals.forEach((goal,index)=>{
    assert.ok(city.goalAssigned[index]>=city.byGoal[index],`${context}: arrivals exceed reservations`);
    if(goal.input!=null)assert.ok(city.goalAssigned[index]<=goal.input,`${context}: goal capacity exceeded`);
  });
  assert.equal(city.departedByHome.reduce((sum,count)=>sum+count,0),city.cars.filter(car=>!car.done).length+city.delivered,`${context}: cars are duplicated or lost`);
  const slots=new Set();
  for(const vehicle of city.cars.filter(car=>!car.done))for(const reservation of city.reservations(vehicle)){
    const key=[reservation.cell,reservation.heading,reservation.lane,reservation.slot].join(':');
    assert.ok(!slots.has(key),`${context}: overlapping vehicle reservation ${key}`);slots.add(key);
  }
  for(const cell of city.roads){const load=city.load(cell);assert.ok(load.used<=load.capacity,`${context}: road directional capacity exceeded at ${cell}`);}
}

test('deterministic randomized planning keeps edits atomic and designs valid', () => {
  for(let seed=1;seed<=40;seed++){
    const next=random(seed),level=LEVELS[seed%LEVELS.length],city=new City(level.id,{budget:220});
    for(let step=0;step<120;step++){
      const cell=integer(next,city.width*city.height),ops=integer(next,6),neighbor=choose(next,city.neighbors(cell)),grade=integer(next,ROAD_TYPES.length);
      if(ops===0)city.connect(cell,neighbor,grade);
      else if(ops===1)city.edit(cell,false,grade);
      else if(ops===2)city.edit(cell,true,grade);
      else if(ops===3)city.cut(cell,neighbor);
      else if(ops===4&&city.roads.size){const road=choose(next,[...city.roads]);city.setRoadPolicy([road],choose(next,['prefer','avoid',null]));}
      else city.transact([{type:'connect',a:cell,b:neighbor,grade},{type:'edit',cell:neighbor,erase:next()<.25,grade:integer(next,ROAD_TYPES.length)}]);
      assertDesignInvariants(city,`seed ${seed}, step ${step}`);
    }
    const design=city.serializeDesign(),copy=new City(level.id,{budget:220});
    assert.equal(copy.loadDesign(JSON.parse(JSON.stringify(design))),'',`seed ${seed}: valid randomized design must load`);
    assert.deepEqual(copy.serializeDesign(),design,`seed ${seed}: design round-trip changed data`);
  }
});

test('deterministic randomized traffic conserves people, capacity and reservations', () => {
  for(let seed=1;seed<=30;seed++){
    const next=random(seed*7919),city=new City('neighborhood',{budget:400,duration:45,deadlineMode:true});
    city.water.clear();city.bridges.clear();city.trees.clear();city.roads.clear();city.roadGrades.clear();city.edges.clear();city.signals.clear();
    const firstPassengers=8+integer(next,13),secondPassengers=8+integer(next,13);
    city.setRoutes([
      {name:'横向路线',color:'#638d69',light:'#dae6cb',homes:[{cell:city.key(1,3),generationRate:1+integer(next,4),passengers:firstPassengers}],goals:[{cell:city.key(14,3),label:'横向终点',input:firstPassengers}]},
      {name:'纵向路线',color:'#d19157',light:'#f2dfbf',homes:[{cell:city.key(8,1),generationRate:1+integer(next,4),passengers:secondPassengers}],goals:[{cell:city.key(8,10),label:'纵向终点',input:secondPassengers}]}
    ]);
    const row=4+integer(next,5),column=3+integer(next,10),paths=[
      edgePath(city,[{x:1,y:3},{x:2,y:3},{x:2,y:row},{x:13,y:row},{x:13,y:3},{x:14,y:3}]),
      edgePath(city,[{x:8,y:1},{x:8,y:2},{x:column,y:2},{x:column,y:9},{x:8,y:9},{x:8,y:10}])
    ];
    for(const path of paths)for(let index=1;index<path.length;index++)assert.equal(city.connect(path[index-1],path[index]),'',`seed ${seed}: generated path must be legal`);
    for(const cell of city.roads)assert.equal(city.edit(cell,false,integer(next,ROAD_TYPES.length)),'');
    for(const [cell] of city.signals)assert.equal(city.setSignal(cell,next()<.6,choose(next,[2,4,6])),'');
    for(const cell of [...city.roads].filter(()=>next()<.08))assert.equal(city.setRoadPolicy([cell],'prefer'),'');
    assert.ok(city.paths.every(Boolean),`seed ${seed}: generated homes must be reachable`);
    assertDesignInvariants(city,`seed ${seed}, before operation`);
    for(const [a,links] of city.edges)for(const b of links)if(a<b&&city.roads.has(b)){
      const base=city.roadTravelCost(a,b),dynamic=city.dynamicRoadTravelCost(a,b);
      assert.ok(dynamic>=base,`seed ${seed}: dynamic cost undercut free-flow cost`);
    }
    city.toggle();
    for(let step=0;step<900&&city.state==='running';step++){
      city.step(.05);
      if(step%10===0)assertSimulationInvariants(city,`seed ${seed}, step ${step}`);
    }
    assertSimulationInvariants(city,`seed ${seed}, final`);
  }
});
