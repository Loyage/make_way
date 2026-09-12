'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { City, CampaignSession, campaignIncome, conditionMet, migrateCampaignLevel, materializeCampaignRoutes, campaignBuildingState, verifyCampaignReferenceChain, LEVELS, CHAPTERS, WIDTH, HEIGHT, key, point } = require('../src/shared/core.js');
const { validateLevelCatalog } = require('../src/shared/level-validation.js');
const { commuteReport, starReport } = require('../src/game/game-results.js');

const { buildReferencePlan, line } = require('./reference-plan.cjs');
const PLAYER_LEVELS=CHAPTERS.filter(chapter=>!chapter.hidden).flatMap(chapter=>chapter.levels);

test('all level definitions have valid independent terrain and state', () => {
  for(const level of LEVELS) {
    const city = new City(level.id),buildings = [...city.homes.map(h => h.cell), ...city.goals.map(g => g.cell)];
    assert.equal(new Set(buildings).size, buildings.length,level.id);
    for (const n of [...level.water,...level.bridges,...level.trees,...buildings]) assert.ok(Number.isInteger(n)&&n>=0&&n<city.width*city.height,level.id);
    for (const n of buildings) assert.ok(!city.water.has(n)&&!city.trees.has(n),level.id);
    for (const n of city.trees) assert.ok(!city.water.has(n),level.id);
    for (const n of city.bridges) assert.ok(city.water.has(n),level.id);
    assert.equal(city.queues.length,city.homes.length);assert.equal(city.remaining,level.budget-[...city.roads].reduce((sum,n)=>sum+1+(city.roadGrades.get(n)||0),0));
    const other = new City(level.id);city.queues[0]++;assert.equal(other.queues[0],0,level.id);
  }
});

for (const level of PLAYER_LEVELS) test(`${level.name}: a legal reference plan wins within budget and time`, () => {
  const city = new City(level.id);buildReferencePlan(city);
  assert.ok(city.paths.every(Boolean)||city.homes.every((home,index)=>city.busItineraryFor(index)),'reference plan must serve every home');city.toggle();
  for(let i=0;i<(level.duration+1)*20;i++)city.step(.05);
  assert.equal(city.state,'won',`${city.delivered}/${city.target}, roads ${level.budget-city.remaining}, deliveries ${city.byRoute}`);
  assert.ok(city.byRoute.every(n=>n>0));assert.ok(city.remaining>=0);
  const report=commuteReport(city.commuteTimes,Math.max(0,city.generated.reduce((sum,count)=>sum+count,0)-city.delivered));
  assert.equal(starReport(level.starTargets,{won:true,score:report.score,cost:city.budget-city.remaining,maxQueue:Math.max(0,...city.maxHomeQueues)}).count,3,'reference plan should demonstrate all three star goals');
});
test('the shared validator accepts the active catalog', () => {
  assert.deepEqual(validateLevelCatalog({ version: 1, chapters: CHAPTERS }), { ok: true, errors: [] });
});
test('three player chapters follow roads, junctions and public transit, with an admin-only archive', () => {
  assert.deepEqual(CHAPTERS.map(chapter=>[chapter.id,chapter.name,chapter.levels.length,chapter.hidden]),[
    ['road-basics','道路入门',5,false],['junction-control','路口调度',7,false],['public-transit','公共交通',5,false],['design-archive','设计素材库',5,true]
  ]);
  assert.deepEqual(CHAPTERS.flatMap(chapter=>chapter.levels),LEVELS);
  const visible=CHAPTERS.filter(chapter=>!chapter.hidden).flatMap(chapter=>chapter.levels);
  assert.deepEqual(visible.map(level=>level.id),['neighborhood','demolition-school','avenue-school','cut-school','growing-city','junction-basics','woodland','signal-cross','signal-demand','signal-timing','signal-distribution','junction-campaign','bus-intro','bus-pipeline','bridge-transfer','bus-only-street','transit-campaign']);
  assert.equal(LEVELS.find(level=>level.id==='woodland').features.signals,false,'ring-road lesson precedes traffic lights');
  assert.equal(LEVELS.find(level=>level.id==='signal-cross').features.signals,true,'traffic lights begin in lesson 2.3');
  assert.ok(visible.slice(0,12).every(level=>!level.features.bus),'bus must remain locked through chapter two');
  assert.ok(visible.slice(12).every(level=>level.features.bus),'chapter three teaches public transit');
  assert.equal(LEVELS.find(level=>level.id==='signal-distribution').routes[0].homes.length,2);
  assert.equal(LEVELS.find(level=>level.id==='signal-distribution').routes[0].goals.length,2);
  assert.equal(LEVELS.find(level=>level.id==='transit-campaign').busLineLimit,2);
  for(const id of ['growing-city','junction-campaign','transit-campaign'])assert.equal(LEVELS.find(level=>level.id===id).campaign.days.length,5);
  assert.throws(()=>new City('missing'),RangeError);
  assert.throws(()=>{LEVELS[0].budget=999;},TypeError);
});
test('legacy per-day campaign routes migrate to potential buildings', () => {
  const source=JSON.parse(JSON.stringify(LEVELS.find(item=>item.id==='growing-city'))),potential=source.campaign.routes;
  source.campaign.days=source.campaign.days.map((day,index)=>({...day,routes:materializeCampaignRoutes(source,index,Array.from({length:index},()=>({delivered:2000,income:100,satisfaction:100})),source.campaign.regions.filter(region=>(region.unlock.day||1)<=index+1).map(region=>region.id))}));
  const firstReference=source.campaign.days[0].referenceDesign;
  source.routes=source.campaign.days[0].routes;delete source.campaign.routes;migrateCampaignLevel(source);
  assert.equal(source.campaign.routes.length,potential.length);assert.ok(source.campaign.days.every(day=>!Object.hasOwn(day,'routes')));assert.deepEqual(source.campaign.days[0].referenceDesign,firstReference);
  assert.equal(materializeCampaignRoutes(source,1,[{delivered:42,income:18,satisfaction:100}],['expansion-2']).length,2);
});

test('multi-day campaign conditions unlock and upgrade potential buildings', () => {
  assert.equal(conditionMet({day:2,delivered:40,income:10,satisfaction:80},2,[{delivered:40,income:10,satisfaction:80}]),true);
  assert.equal(conditionMet({day:2,delivered:41},2,[{delivered:40,income:20,satisfaction:100}]),false);
  const level=LEVELS.find(item=>item.id==='growing-city');
  assert.equal(materializeCampaignRoutes(level,0,[]).length,1);
  const day2=materializeCampaignRoutes(level,1,[{delivered:100000,income:100,satisfaction:100}],['expansion-2']);
  assert.equal(day2.length,2);assert.ok(day2[0].homes[0].passengers>=level.routes[0].homes[0].passengers);
});

test('multi-day campaign pays to open qualified map regions and replays checkpoints', () => {
  assert.equal(campaignIncome(50,100,80,20),12);
  const campaign=new CampaignSession('growing-city'),region=campaign.level.campaign.regions[0];
  assert.equal(campaign.days.length,5);assert.equal(campaign.city.pendingBuildings.size,8);
  assert.equal(campaign.city.pendingBuildings.get(20).daysUntil,1);
  assert.match(campaign.city.edit(region.cells[0]),/区域尚未开放/);
  assert.equal(campaign.unlockRegion(region.id),'尚未完成该区域的开放任务');
  assert.equal(campaign.city.edit(0),'');
  assert.equal(campaign.beginDay(),'');assert.ok(campaign.checkpoints[0]);
  campaign.city.delivered=campaign.city.target;campaign.city.step(.05);
  const firstPopulation=campaign.city.target,baseBudget=campaign.level.budget,maxIncome=campaign.days[0].maxIncome;
  const result=campaign.advance(100);assert.equal(result.population,firstPopulation);assert.equal(result.income,maxIncome);assert.equal(campaign.dayIndex,1);
  assert.equal(campaign.city.homes.length,1,'新建筑须等待玩家支付区域费用');
  const before=campaign.city.remaining;assert.equal(campaign.unlockRegion(region.id),'');assert.equal(campaign.city.remaining,before-region.cost);assert.equal(campaign.city.homes.length,2);
  assert.equal(campaign.replay(0),'');assert.equal(campaign.dayIndex,0);assert.equal(campaign.results.length,0);assert.equal(campaign.unlockedRegionIds.size,0);
  assert.equal(campaign.city.budget,baseBudget);assert.ok(campaign.city.roads.has(0));assert.equal(campaign.city.state,'planning');
});

test('one-sided unlocked buildings stay dormant and do not enter population scoring', () => {
  const level=JSON.parse(JSON.stringify(LEVELS.find(item=>item.id==='growing-city'))),route=level.campaign.routes[1];
  route.goals[0].unlock.day=3;
  const state=campaignBuildingState(level,1,[{delivered:20,income:18,satisfaction:100}],['expansion-2']);
  assert.equal(state.routes.length,1);assert.ok(state.dormant.some(building=>building.kind==='home'&&building.cell===route.homes[0].cell));
  assert.ok(!state.dormant.some(building=>building.kind==='goal'&&building.cell===route.goals[0].cell));
});

test('campaign references respect the player actual accumulated budget', () => {
  const campaign=new CampaignSession('growing-city'),last=campaign.days.at(-1).referenceDesign;
  campaign.unlockedRegionIds=new Set(campaign.level.campaign.regions.map(region=>region.id));campaign.regionSpent=campaign.level.campaign.regions.reduce((sum,region)=>sum+region.cost,0);
  assert.throws(()=>campaign.createCity(campaign.days.length-1,campaign.level.budget,last),/建设预算不足/);
  assert.equal(campaign.dayIndex,0);assert.equal(campaign.city.state,'planning');
});

test('every chapter campaign reference chain self-runs with actual results', () => {
  for(const id of ['growing-city','junction-campaign','transit-campaign']) {
    const verified=verifyCampaignReferenceChain(id);
    assert.equal(verified.ok,true,`${id}: ${verified.error}`);assert.equal(verified.days,5);assert.equal(verified.results.length,5);
    assert.deepEqual(verified.results.map(result=>result.day),[1,2,3,4,5]);
    assert.ok(verified.results.every(result=>result.delivered===result.population&&result.income>=0));
  }
});

test('campaign reference help returns to the first divergent day', () => {
  const campaign=new CampaignSession('growing-city');assert.equal(campaign.loadReference(0),'');
  assert.equal(campaign.city.edit(0),'');assert.equal(campaign.beginDay(),'');assert.equal(campaign.referenceDivergenceDay,0);
  while(campaign.city.state==='running')campaign.city.step(.05);
  assert.equal(campaign.city.state,'won');campaign.advance(100);
  assert.match(campaign.loadReference(1),/第 1 天起已偏离/);
  assert.equal(campaign.replay(0),'');assert.equal(campaign.loadReference(0),'');assert.equal(campaign.referenceDivergenceDay,null);
});

test('multi-day campaign rewards rebuilding into affordable routes without intersections', () => {
  const campaign=new CampaignSession('growing-city');
  const plans=[
    [[1,2,1,0],[1,0,14,0],[14,0,14,2]],
    [[4,1,4,5]],
    [[1,4,1,6],[1,6,8,6],[8,6,8,4]],
    [[7,3,9,3],[9,3,9,10],[9,10,7,10]],
    [[5,8,5,11],[5,11,14,11],[14,11,14,8]]
  ];
  const crossingCells=[null,key(4,2),key(4,4),key(7,4),key(7,8)];
  const routeRoads=[];
  const onDirectPath=(route,cell)=>{
    const a=point(route.homes[0].cell),b=point(route.goals[0].cell),p=point(cell);
    return a.x===b.x ? p.x===a.x&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y) :
      a.y===b.y&&p.y===a.y&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x);
  };
  for(let day=0;day<5;day++) {
    for(const region of campaign.availableRegions())assert.equal(campaign.unlockRegion(region.id),'');
    const reference=campaign.days[day].referenceDesign,referenceCity=campaign.createCity(day,campaign.city.budget,reference);
    assert.ok(reference);assert.ok(referenceCity.paths.every(Boolean),`day ${day+1} reference must serve every route`);assert.equal(referenceCity.remaining>=0,true);referenceCity.toggle();for(let step=0;step<(referenceCity.duration+1)*20;step++)referenceCity.step(.05);assert.equal(referenceCity.state,'won',`day ${day+1} reference must win`);
    if(day) {
      assert.ok(onDirectPath(campaign.city.routes[day-1],crossingCells[day]));
      assert.ok(onDirectPath(campaign.city.routes[day],crossingCells[day]),`day ${day+1} should tempt routes to cross`);
      for(const cell of routeRoads[day-1]) assert.equal(campaign.city.edit(cell,false,1),'');
    }
    const before=new Set(campaign.city.roads);
    for(const segment of plans[day]) line(campaign.city,...segment,0);
    const added=new Set([...campaign.city.roads].filter(cell=>!before.has(cell)));
    for(const earlier of routeRoads) for(const cell of added) assert.ok(!earlier.has(cell),`day ${day+1} route intersects at ${cell}`);
    routeRoads.push(added);
    assert.ok(campaign.city.remaining>=0);assert.equal(campaign.beginDay(),'');
    for(let step=0;step<(campaign.city.duration+1)*20;step++) campaign.city.step(.05);
    assert.equal(campaign.city.state,'won',`day ${day+1}: ${campaign.city.delivered}/${campaign.city.target}`);
    if(day<4) campaign.advance(100);
  }
});

module.exports = { buildReferencePlan };
