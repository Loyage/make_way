'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { City, CampaignSession, campaignIncome, conditionMet, migrateCampaignLevel, materializeCampaignRoutes, LEVELS, CHAPTERS, WIDTH, HEIGHT, key, point } = require('../src/shared/core.js');
const { validateLevelCatalog } = require('../src/shared/level-validation.js');

const { buildReferencePlan, line } = require('./reference-plan.cjs');
for (const level of LEVELS) {
  test(`${level.name}: valid independent terrain and dynamic route counts`, () => {
    const city = new City(level.id);
    const buildings = [...city.homes.map(h => h.cell), ...city.goals.map(g => g.cell)];
    assert.equal(new Set(buildings).size, buildings.length);
    for (const n of [...level.water,...level.bridges,...level.trees,...buildings]) assert.ok(Number.isInteger(n)&&n>=0&&n<WIDTH*HEIGHT);
    for (const n of buildings) assert.ok(!city.water.has(n)&&!city.trees.has(n));
    for (const n of city.trees) assert.ok(!city.water.has(n));
    for (const n of city.bridges) assert.ok(city.water.has(n));
    assert.equal(city.queues.length,city.homes.length);assert.equal(city.remaining,level.budget-[...city.roads].reduce((sum,n)=>sum+1+(city.roadGrades.get(n)||0),0));
    const other = new City(level.id);city.queues[0]++;assert.equal(other.queues[0],0);
  });
  test(`${level.name}: a legal reference plan wins within budget and time`, () => {
    const city = new City(level.id);buildReferencePlan(city);
    assert.ok(city.paths.every(Boolean));city.toggle();
    for(let i=0;i<(level.duration+1)*20;i++) {
      city.step(.05);
      for(const car of city.cars) if(car.next!==null && car.next!==car.cell) assert.ok(city.links(car.cell).includes(car.next),'vehicle crossed an unconnected edge');
      for(const n of city.roads) {
        const load=city.load(n);
        assert.ok(load.used<=load.capacity, `${level.id}: capacity exceeded at ${n}`);
        if (!city.signals.has(n)) {
          const slots = new Map();
          for (const car of city.occupants(n)) for (const r of city.reservations(car)) {
            if (r.cell !== n) continue;
            const id = `${r.heading}/${r.lane}/${r.slot}`;
            assert.ok(!slots.has(id) || slots.get(id) === car, `${level.id}: overlapping slot at ${n}`);
            slots.set(id, car);
          }
        }
      }
    }
    assert.equal(city.state,'won',`${city.delivered}/${city.target}, roads ${level.budget-city.remaining}, deliveries ${city.byRoute}`);
    assert.ok(city.byRoute.every(n=>n>0));assert.ok(city.remaining>=0);
  });
  test(`${level.name}: isolated demand loses at its own deadline`, () => {
    const city = new City(level.id);city.edges.clear();city.refreshPaths();city.toggle();
    for(let i=0;i<(level.duration+1)*20;i++)city.step(.05);
    assert.equal(city.state,'lost');assert.equal(city.elapsed,level.duration);
  });
}
test('the shared validator accepts the active catalog', () => {
  assert.deepEqual(validateLevelCatalog({ version: 1, chapters: CHAPTERS }), { ok: true, errors: [] });
});
test('two chapters contain ten progressively unlocked levels, including the five-day challenge', () => {
  assert.deepEqual(CHAPTERS.map(chapter=>[chapter.id,chapter.name,chapter.levels.length]),[['road-basics','道路入门',5],['city-control','城市调度',5]]);
  assert.deepEqual(CHAPTERS.flatMap(chapter=>chapter.levels),LEVELS);
  assert.deepEqual(LEVELS.map(l=>l.id),['neighborhood','demolition-school','avenue-school','cut-school','growing-city','woodland','rush-hour','signal-school','multi-route-school','bus-school']);
  for(const id of ['bridge-school','riverside']) assert.throws(()=>new City(id),RangeError);
  const names=['grade','load','cut','inspect','signals','bus'];
  assert.equal(LEVELS.find(level=>level.id==='cut-school').features.cut,true,'scissors must be available from lesson four');
  assert.equal(LEVELS.find(level=>level.id==='woodland').features.signals,true,'signals must be available from chapter two');
  for(const name of names) {
    const values=LEVELS.map(level=>level.features[name]);
    assert.ok(values.includes(false)&&values.includes(true),`${name} must be taught`);
    assert.equal(values.join('').includes('truefalse'),false,`${name} cannot relock`);
  }
  const multi = LEVELS.find(level => level.id === 'multi-route-school').routes[0];
  assert.equal(multi.homes.length, 2);
  assert.equal(multi.goals.length, 2);
  assert.ok(multi.goals.every(goal => goal.input === 60));
  assert.equal(LEVELS.at(-1).features.bus,true,'bus routes unlock in the final lesson');
  for (const id of ['signal-school','rush-hour']) {
    const routes = LEVELS.find(level => level.id === id).routes;
    assert.ok(routes.some(route => route.homes.length > 1 && route.goals.length > 1), `${id} should reuse multi-point demand`);
  }
  assert.throws(()=>new City('missing'),RangeError);
  assert.throws(()=>{LEVELS[0].budget=999;},TypeError);
});
test('legacy per-day campaign routes migrate to potential buildings', () => {
  const source=JSON.parse(JSON.stringify(LEVELS.find(item=>item.id==='growing-city'))),potential=source.campaign.routes;
  source.campaign.days=source.campaign.days.map((day,index)=>({...day,routes:materializeCampaignRoutes(source,index,Array.from({length:index},()=>({delivered:2000,income:100,satisfaction:100})))}));
  source.routes=source.campaign.days[0].routes;delete source.campaign.routes;migrateCampaignLevel(source);
  assert.equal(source.campaign.routes.length,potential.length);assert.ok(source.campaign.days.every(day=>!Object.hasOwn(day,'routes')));
  assert.equal(materializeCampaignRoutes(source,1,[{delivered:42,income:18,satisfaction:100}]).length,2);
});

test('multi-day campaign conditions unlock and upgrade potential buildings', () => {
  assert.equal(conditionMet({day:2,delivered:40,income:10,satisfaction:80},2,[{delivered:40,income:10,satisfaction:80}]),true);
  assert.equal(conditionMet({day:2,delivered:41},2,[{delivered:40,income:20,satisfaction:100}]),false);
  const level=LEVELS.find(item=>item.id==='growing-city');
  assert.equal(materializeCampaignRoutes(level,0,[]).length,1);
  const day2=materializeCampaignRoutes(level,1,[{delivered:42,income:18,satisfaction:100}]);
  assert.equal(day2.length,2);assert.equal(day2[0].homes[0].passengers,200);
});

test('multi-day campaign pays for quality, reveals construction, and replays checkpoints', () => {
  assert.equal(campaignIncome(50,100,80,20),12);
  const campaign=new CampaignSession('growing-city');
  assert.equal(campaign.days.length,5);assert.equal(campaign.city.pendingBuildings.size,8);
  assert.equal(campaign.city.pendingBuildings.get(20).daysUntil,1);
  assert.equal(campaign.city.pendingBuildings.get(20).condition.day,2);
  assert.match(campaign.city.edit(20),/建设用地/);
  assert.equal(campaign.city.edit(0),'');
  assert.equal(campaign.beginDay(),'');assert.ok(campaign.checkpoints[0]);
  campaign.city.delivered=campaign.city.target;campaign.city.step(.05);
  assert.equal(campaign.city.state,'running','campaign days always run to the deadline');
  campaign.city.state='won';
  const result=campaign.advance(100);assert.equal(result.population,42);assert.equal(result.delivered,42);assert.equal(result.income,18);assert.equal(campaign.dayIndex,1);
  assert.equal(campaign.city.budget,52);assert.ok(campaign.city.roads.has(0));assert.equal(campaign.city.homes.length,2);
  assert.equal(campaign.replay(0),'');assert.equal(campaign.dayIndex,0);assert.equal(campaign.results.length,0);
  assert.equal(campaign.city.budget,34);assert.ok(campaign.city.roads.has(0));assert.equal(campaign.city.state,'planning');
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
