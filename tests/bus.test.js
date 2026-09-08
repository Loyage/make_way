'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { City, BUS_CAPACITY, BUS_SPEED_MULTIPLIER, BUS_BOARDING_RATE, BUS_COST } = require('../core.js');

function loop(city) {
  const route=city.level.initialEdges.slice(0,32).map(edge=>edge[0]);
  route.push(route[0]);
  return route;
}
function run(city, seconds) { for(let i=0;i<seconds*20&&city.state==='running';i++) city.step(.05); }

test('bus route must be a closed walk over explicit existing road connections', () => {
  const city=new City('bus-school'),route=loop(city),before=city.remaining;
  assert.ok(city.setBusRoute(route.slice(0,-1)));
  assert.ok(city.setBusRoute([route[0],route[2],route[0]]));
  assert.equal(city.setBusRoute([route[0],route[1],route[0]]),'','an immediate return over the same edge is legal');
  assert.equal(city.remaining,before-BUS_COST);
  assert.ok(city.cut(route[0],route[1]));
  assert.ok(city.edit(route[0],true));
  assert.equal(city.setBusRoute([]),'');assert.equal(city.remaining,before);
});

test('one to three buses consume budget and survive design round trips', () => {
  const source=new City('bus-school'),route=loop(source);
  assert.equal(source.setBusCount(3),'');assert.equal(source.setBusRoute(route),'');
  assert.equal(source.setBusStop(source.homes[0].cell,false),'');assert.equal(source.isBusStop(source.homes[0].cell),false);
  assert.equal(source.remaining,0);
  const design=source.serializeDesign(),target=new City('bus-school');
  assert.equal(design.version,3);assert.equal(target.loadDesign(design),'');
  assert.deepEqual(target.busRoute,route);assert.equal(target.busCount,3);assert.equal(target.isBusStop(target.homes[0].cell),false);assert.deepEqual(target.serializeDesign(),design);
  assert.ok(target.setBusCount(4));
  target.toggle();assert.equal(target.buses.length,3);assert.ok(target.setBusRoute([]));assert.ok(target.setBusCount(1));
  target.toggle();assert.equal(target.stop(),true);assert.equal(target.buses.length,0);assert.deepEqual(target.busRoute,route);
});

test('adjacent buildings become stops without road edges and can be toggled manually', () => {
  const city=new City('bus-school'),route=loop(city),home=city.homes[0];
  for(const road of city.links(home.cell)) city.removeEdge(home.cell,road);
  assert.equal(city.setBusRoute(route),'');assert.equal(city.isBusStop(home.cell),true);
  assert.equal(city.setBusStop(home.cell,false),'');assert.equal(city.isBusStop(home.cell),false);
  assert.equal(city.setBusStop(home.cell,true),'');assert.equal(city.isBusStop(home.cell),true);
  const position=city.busStopPositions(home.cell)[0],bus={cell:route[position],routePosition:position,passengers:[],dwell:0,needsStop:true};
  city.serviceBusStop(bus);assert.ok(bus.passengers.length>0,'the adjacent stop boards without a building-road edge');
  assert.equal(city.departedByHome[0],bus.passengers.length);
  const goalPosition=city.busStopPositions(city.goals[0].cell)[0];bus.cell=route[goalPosition];bus.routePosition=goalPosition;
  city.serviceBusStop(bus);assert.ok(city.byGoal[0]>0);
});

test('a bus skips homes whose destination is off-line or already full', () => {
  const city=new City('bus-school'),homeRoad=city.level.initialEdges[31][0],next=city.level.initialEdges[31][1];
  assert.equal(city.setBusRoute([homeRoad,next,homeRoad]),'');
  const bus={cell:homeRoad,routePosition:0,passengers:[],dwell:0,needsStop:true};
  city.serviceBusStop(bus);
  assert.equal(bus.passengers.length,0,'the matching destination is not on this short line');
  assert.equal(city.generated[0],0);

  const full=new City('bus-school');assert.equal(full.setBusRoute(loop(full)),'');
  full.goalAssigned[0]=full.goals[0].input;
  const fullBus={cell:homeRoad,routePosition:31,passengers:[],dwell:0,needsStop:true};
  full.serviceBusStop(fullBus);
  assert.equal(fullBus.passengers.length,0,'a full destination cannot receive bus passengers');
  assert.equal(full.generated[0],0);
});

test('the bus lesson requires public transport and is winnable with one bus', () => {
  const carsOnly=new City('bus-school');carsOnly.toggle();run(carsOnly,60);
  assert.equal(carsOnly.state,'lost');assert.ok(carsOnly.delivered<carsOnly.level.target);
  const withBus=new City('bus-school');assert.equal(withBus.setBusRoute(loop(withBus)),'');withBus.toggle();run(withBus,60);
  assert.equal(withBus.state,'won');assert.ok(withBus.delivered>=withBus.level.target);
});

test('buses bypass home output rate, respect capacity, and deliver eligible passengers', () => {
  const city=new City('bus-school'),route=loop(city);
  assert.equal(BUS_CAPACITY,12);assert.ok(BUS_SPEED_MULTIPLIER>1);assert.equal(BUS_BOARDING_RATE,8);
  assert.equal(city.setBusCount(3),'');assert.equal(city.setBusRoute(route),'');city.toggle();
  run(city,12);
  assert.ok(city.generated.some((count,i)=>count>city.homes[i].rate*city.elapsed+2),'bus pickup should not wait for private-car output');
  assert.ok(city.buses.every(bus=>bus.passengers.length<=BUS_CAPACITY));
  assert.ok(city.departedByHome.some(count=>count>0));
  assert.ok(city.departedByHome.every((count,i)=>count<=city.homes[i].passengers));
  assert.ok(city.goalAssigned.every((count,i)=>city.goals[i].input==null||count<=city.goals[i].input));
  run(city,40);
  assert.equal(city.state,'won');assert.ok(city.delivered>=city.level.target);
  assert.ok(city.arrivals.some(event=>event.vehicle==='bus'));
  assert.ok(city.byRoute.every(count=>count>0));
});
