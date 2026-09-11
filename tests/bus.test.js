'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/shared/core.js');
const { City, BUS_CAPACITY, BUS_SPEED_MULTIPLIER, BUS_BOARDING_RATE, BUS_COST } = core;

function loop(city) {
  const route=city.level.initialEdges.slice(0,32).map(edge=>edge[0]);
  route.push(route[0]);
  return route;
}
function run(city, seconds) { for(let i=0;i<seconds*20&&city.state==='running';i++) city.step(.05); }

test('bus routes can be drawn in sections but regular service requires a closed walk', () => {
  const city=new City('bus-school'),route=loop(city),before=city.remaining;
  assert.ok(city.setBusRoute([route[0],route[2]]));
  assert.equal(city.appendBusRoute(route.slice(0,2)),'');
  assert.equal(city.remaining,before-BUS_COST);
  const partial=city.serializeDesign(),partialCopy=new City('bus-school');assert.equal(partialCopy.loadDesign(partial),'');assert.deepEqual(partialCopy.busRoute,city.busRoute);
  assert.ok(city.preflightCheck().issues.some(issue=>issue.code==='bus-invalid'));assert.equal(city.toggle(),'');assert.equal(city.state,'running');assert.equal(city.buses.length,0);city.stop();
  assert.ok(city.appendBusRoute([route[0],route[1]]));
  assert.equal(city.appendBusRoute(route.slice(1)),'');assert.deepEqual(city.busRoute,route);
  const trimmed=[route.at(-1),route.at(-2),route.at(-3)];assert.equal(city.trimBusRoute(trimmed),'');assert.deepEqual(city.busRoute,route.slice(0,-2));
  assert.ok(city.trimBusRoute([city.busRoute.at(-1),route[0]]));
  assert.equal(city.appendBusRoute(route.slice(-3)),'');assert.deepEqual(city.busRoute,route);
  assert.equal(city.toggle(),'');assert.equal(city.state,'running');city.stop();
  assert.ok(city.cut(route[0],route[1]));
  assert.ok(city.edit(route[0],true));
  assert.equal(city.setBusRoute([]),'');assert.equal(city.remaining,before);
});

test('one to three buses consume budget and survive design round trips', () => {
  const source=new City('bus-school'),route=loop(source);
  assert.equal(source.setBusCount(3),'');assert.equal(source.setBusRoute(route),'');
  const stopCell=route[source.busStopPositions(source.homes[0].cell)[0]];
  assert.equal(source.setBusStop(stopCell,false),'');assert.equal(source.isBusStop(stopCell),false);
  assert.equal(source.remaining,0);
  const design=source.serializeDesign(),target=new City('bus-school');
  assert.equal(design.version,8);assert.equal(target.loadDesign(design),'');
  assert.deepEqual(target.busRoute,route);assert.equal(target.busCount,3);assert.equal(target.isBusStop(stopCell),false);assert.deepEqual(target.serializeDesign(),design);
  const legacy=JSON.parse(JSON.stringify(design));legacy.version=4;for(const line of legacy.busLines)delete line.returnTrip;
  const migrated=new City('bus-school');assert.equal(migrated.loadDesign(legacy),'');assert.equal(migrated.activeBusLine.returnTrip,false);
  assert.ok(target.setBusCount(4));
  target.toggle();assert.equal(target.buses.length,3);assert.ok(target.setBusRoute([]));assert.ok(target.setBusCount(1));
  target.toggle();assert.equal(target.stop(),true);assert.equal(target.buses.length,0);assert.deepEqual(target.busRoute,route);
});

test('an open line can return over the same road and skips every stop on the return trip', () => {
  const city=new City('bus-school'),ring=loop(city),outbound=[...ring.slice(31,-1),...ring.slice(0,6)];
  assert.equal(city.setBusRoute(outbound),'');
  assert.ok(city.preflightCheck().issues.some(issue=>issue.code==='bus-invalid'));
  assert.equal(city.updateBusLine(city.activeBusLineId,{returnTrip:true}),'');
  const line=city.activeBusLine,operating=city.busOperatingRoute(line);
  assert.deepEqual(operating,[...outbound,...outbound.slice(0,-1).reverse()]);
  const saved=city.serializeDesign(),copy=new City('bus-school');assert.equal(copy.loadDesign(saved),'');assert.equal(copy.activeBusLine.returnTrip,true);
  assert.equal(city.toggle(),'');assert.equal(city.buses.length,1);
  const goalIndex=0,goal=city.goals[goalIndex],goalRoad=ring[4],outboundPosition=outbound.indexOf(goalRoad),returnPosition=operating.lastIndexOf(goalRoad);
  const passenger={route:goal.route,goal:goal.cell,goalIndex,commuteStarted:0};
  const bus={lineId:line.id,cell:goalRoad,routePosition:returnPosition,passengers:[passenger],dwell:0,needsStop:true};
  city.serviceBusStop(bus);assert.equal(bus.passengers.length,1,'the return trip must not unload at stops');
  bus.routePosition=outboundPosition;bus.needsStop=true;city.serviceBusStop(bus);
  assert.equal(bus.passengers.length,0);assert.equal(city.byGoal[goalIndex],1);
  city.stop();assert.equal(city.updateBusLine(line.id,{returnStops:true}),'');city.toggle();
  const returning={lineId:line.id,cell:goalRoad,routePosition:returnPosition,passengers:[passenger],dwell:0,needsStop:true};city.serviceBusStop(returning);
  assert.equal(returning.passengers.length,0,'enabled return stops unload passengers in the return direction');
});

test('road cells become stops for adjacent buildings and can be toggled per line', () => {
  const city=new City('bus-school'),route=loop(city),home=city.homes[0];
  for(const road of city.links(home.cell)) city.removeEdge(home.cell,road);
  assert.equal(city.setBusRoute(route),'');
  const lineId=city.activeBusLineId,position=city.busStopPositions(home.cell,lineId)[0],stopCell=route[position];
  assert.equal(city.isBusStop(stopCell,lineId),true);
  assert.equal(city.setBusStop(stopCell,false,lineId),'');assert.equal(city.busStopPositions(home.cell,lineId).length,0);
  assert.equal(city.setBusStop(stopCell,true,lineId),'');assert.equal(city.isBusStop(stopCell,lineId),true);
  const bus={lineId,cell:stopCell,routePosition:position,passengers:[],dwell:0,needsStop:true};
  city.generated[0]=BUS_CAPACITY;city.queues[0]=BUS_CAPACITY;city.queueTimes[0]=Array(BUS_CAPACITY).fill(0);
  city.serviceBusStop(bus);assert.ok(bus.passengers.length>0,'the adjacent stop boards generated residents without a building-road edge');
  assert.equal(city.departedByHome[0],bus.passengers.length);
  const goalPosition=city.busStopPositions(city.goals[0].cell,lineId)[0];bus.cell=route[goalPosition];bus.routePosition=goalPosition;bus.needsStop=true;
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

test('bus headways, return stops and operating reports are configurable', () => {
  const city=new City('bus-school'),ring=loop(city),outbound=[...ring.slice(31,-1),...ring.slice(0,8)];
  assert.equal(city.setBusCount(2),'');assert.equal(city.setBusRoute(outbound),'');
  assert.equal(city.updateBusLine(city.activeBusLineId,{returnTrip:true,returnStops:true,headway:4}),'');
  assert.equal(city.toggle(),'');assert.equal(city.buses.filter(bus=>bus.active).length,1);
  run(city,3);assert.equal(city.buses.filter(bus=>bus.active).length,1);run(city,3);assert.equal(city.buses.filter(bus=>bus.active).length,2);
  const report=city.busReports()[0];assert.ok(report.averageLoadRate>=0);assert.ok(report.boarded>=0);
  city.stop();const design=city.serializeDesign(),copy=new City('bus-school');assert.equal(copy.loadDesign(design),'');
  assert.equal(copy.activeBusLine.headway,4);assert.equal(copy.activeBusLine.returnStops,true);
});
test('the bus lesson requires public transport and is winnable with one bus', () => {
  const carsOnly=new City('bus-school');carsOnly.toggle();run(carsOnly,60);
  assert.equal(carsOnly.state,'lost');assert.ok(carsOnly.delivered<carsOnly.target);
  const withBus=new City('bus-school');assert.equal(withBus.setBusRoute(loop(withBus)),'');withBus.toggle();run(withBus,60);
  assert.equal(withBus.state,'won');assert.ok(withBus.delivered>=withBus.target);
});

test('buses respect resident generation and deliver eligible passengers in batches', () => {
  const city=new City('bus-school'),route=loop(city);
  assert.equal(BUS_CAPACITY,12);assert.ok(BUS_SPEED_MULTIPLIER>1);assert.equal(BUS_BOARDING_RATE,8);
  assert.equal(city.setBusCount(3),'');assert.equal(city.setBusRoute(route),'');city.toggle();
  run(city,12);
  assert.ok(city.generated.every((count,i)=>count<=city.homes[i].generationRate*city.elapsed+1),'bus pickup must not bypass resident generation');
  assert.ok(city.buses.every(bus=>bus.passengers.length<=BUS_CAPACITY));
  assert.ok(city.departedByHome.some(count=>count>0));
  assert.ok(city.departedByHome.every((count,i)=>count<=city.homes[i].passengers));
  assert.ok(city.goalAssigned.every((count,i)=>city.goals[i].input==null||count<=city.goals[i].input));
  run(city,40);
  assert.equal(city.state,'won');assert.ok(city.delivered>=city.target);
  assert.ok(city.arrivals.some(event=>event.vehicle==='bus'));
  assert.ok(city.byRoute.every(count=>count>0));
});

test('bus metadata updates are atomic when one requested field is invalid', () => {
  const city=new City('bus-school');
  assert.equal(city.createBusLine('原线路','#1686a0'),'');
  const before={name:city.activeBusLine.name,color:city.activeBusLine.color,returnTrip:city.activeBusLine.returnTrip};
  assert.match(city.updateBusLine(city.activeBusLineId,{name:'不应保留',color:'invalid'}),/颜色无效/);
  assert.deepEqual({name:city.activeBusLine.name,color:city.activeBusLine.color,returnTrip:city.activeBusLine.returnTrip},before);
});

test('multiple lines keep independent metadata, vehicles and road stops', () => {
  const original=JSON.parse(JSON.stringify(core.LEVELS));
  const levels=JSON.parse(JSON.stringify(core.LEVELS));
  levels.find(level=>level.id==='bus-school').busLineLimit=3;
  assert.equal(core.setLevels(levels),'');
  try {
    const city=new City('bus-school'),route=loop(city);
    assert.equal(city.setBusRoute(route),'');const first=city.activeBusLineId,stop=city.activeBusLine.stops.values().next().value;
    assert.equal(city.updateBusLine(first,{name:'湖蓝环线',color:'#147f99'}),'');
    assert.equal(city.createBusLine('橙色快线','#d06b47'),'');const second=city.activeBusLineId;
    assert.equal(city.setBusRoute(route),'');assert.equal(city.setBusStop(stop,false,first),'');
    assert.equal(city.isBusStop(stop,first),false);assert.equal(city.isBusStop(stop,second),true);
    assert.deepEqual(city.linesAtCell(stop).map(line=>line.id),[first,second]);
    city.toggle();assert.equal(city.buses.length,2);assert.deepEqual(new Set(city.buses.map(bus=>bus.lineId)),new Set([first,second]));
    city.stop();const design=city.serializeDesign(),copy=new City('bus-school');
    assert.equal(copy.loadDesign(design),'');assert.deepEqual(copy.serializeDesign(),design);
    assert.equal(copy.busLine(first).name,'湖蓝环线');assert.equal(copy.busLine(second).color,'#d06b47');
  } finally { core.setLevels(original); }
});

test('bus itineraries include expected headway when choosing between equivalent lines', () => {
  const original=JSON.parse(JSON.stringify(core.LEVELS)),levels=JSON.parse(JSON.stringify(core.LEVELS));levels.find(level=>level.id==='bus-school').busLineLimit=2;assert.equal(core.setLevels(levels),'');
  try {
    const city=new City('bus-school'),ring=loop(city),route=[ring[31],...ring.slice(0,5)];assert.equal(city.setBusRoute(route),'');const slow=city.activeBusLineId;assert.equal(city.updateBusLine(slow,{returnTrip:true,returnStops:true,headway:8}),'');
    assert.equal(city.createBusLine('高频线','#d06b47'),'');const frequent=city.activeBusLineId;assert.equal(city.setBusRoute(route,frequent),'');assert.equal(city.updateBusLine(frequent,{returnTrip:true,returnStops:true,headway:2}),'');
    assert.equal(city.busItineraryFor(0,0).legs[0].lineId,frequent);
    assert.equal(city.updateBusLine(slow,{headway:2}),'');assert.equal(city.updateBusLine(frequent,{headway:8}),'');assert.equal(city.busItineraryFor(0,0).legs[0].lineId,slow);
  } finally { core.setLevels(original); }
});

test('passengers reserve capacity and transfer once between lines sharing a stop', () => {
  const original=JSON.parse(JSON.stringify(core.LEVELS)),levels=JSON.parse(JSON.stringify(core.LEVELS));levels.find(level=>level.id==='bus-school').busLineLimit=2;assert.equal(core.setLevels(levels),'');
  try {
    const city=new City('bus-school'),ring=loop(city),firstRoute=ring.slice(16,32).reverse(),secondRoute=ring.slice(4,17).reverse(),transferCell=156;
    assert.equal(city.setBusRoute(firstRoute),'');const first=city.activeBusLineId;assert.equal(city.updateBusLine(first,{name:'接驳线',returnTrip:true,returnStops:true,headway:2}),'');assert.equal(city.setBusStop(transferCell,true,first),'');
    assert.equal(city.createBusLine('目的地线','#d06b47'),'');const second=city.activeBusLineId;assert.equal(city.setBusRoute(secondRoute,second),'');assert.equal(city.updateBusLine(second,{returnTrip:true,returnStops:true,headway:4}),'');assert.equal(city.setBusStop(transferCell,true,second),'');
    const itinerary=city.busItineraryFor(0,0);assert.deepEqual(itinerary.legs.map(leg=>leg.lineId),[first,second]);assert.equal(itinerary.transferCell,transferCell);assert.equal(city.busCanReach(city.homes[0].cell,city.goals[0].cell),true);
    assert.equal(city.setBusStop(transferCell,false,second),'');assert.equal(city.busItineraryFor(0,0),null,'both lines must enable the same road stop');assert.equal(city.setBusStop(transferCell,true,second),'');
    city.toggle();city.generated[0]=1;city.queues[0]=1;city.queueTimes[0]=[0];
    const plan=city.busItineraryFor(0,0),firstLeg=plan.legs[0],secondLeg=plan.legs[1],firstBus={lineId:first,cell:firstLeg.boardCell,routePosition:firstLeg.boardPosition,passengers:[],dwell:0,needsStop:true};
    city.elapsed=1;city.serviceBusStop(firstBus);assert.equal(firstBus.passengers.length,1);assert.equal(city.goalAssigned[0],1,'final capacity is reserved on the first boarding');assert.equal(city.departedByHome[0],1);
    firstBus.cell=transferCell;firstBus.routePosition=firstLeg.alightPosition;firstBus.needsStop=true;city.elapsed=3;city.serviceBusStop(firstBus);assert.equal(firstBus.passengers.length,0);assert.equal(city.transferPassengers().length,1);assert.deepEqual(city.passengerBreakdown(0),{total:44,ungenerated:43,waiting:0,carTransit:0,busTransit:1,arrived:0});
    const secondBus={lineId:second,cell:transferCell,routePosition:secondLeg.boardPosition,passengers:[],dwell:0,needsStop:true};city.elapsed=7;city.serviceBusStop(secondBus);assert.equal(secondBus.passengers.length,1);assert.equal(city.transferPassengers().length,0);assert.equal(city.transferReport().transfers,1);assert.equal(city.transferReport().averageWait,4);assert.equal(city.transferReport().maxWaiting,1);
    secondBus.cell=secondLeg.alightCell;secondBus.routePosition=secondLeg.alightPosition;secondBus.needsStop=true;city.elapsed=9;city.serviceBusStop(secondBus);assert.equal(city.delivered,1);assert.equal(city.byGoal[0],1);assert.equal(city.commuteTimes[0],9);
    const reports=city.busReports();assert.equal(reports.find(item=>item.id===first).transfersOut,1);assert.equal(reports.find(item=>item.id===second).transfersIn,1);
  } finally { core.setLevels(original); }
});
