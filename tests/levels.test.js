'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { City, CampaignSession, campaignIncome, LEVELS, CHAPTERS, WIDTH, HEIGHT } = require('../core.js');

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
test('two chapters contain ten progressively unlocked levels, including the five-day challenge', () => {
  assert.deepEqual(CHAPTERS.map(chapter=>[chapter.id,chapter.name,chapter.levels.length]),[['road-basics','道路入门',6],['city-control','城市调度',4]]);
  assert.deepEqual(CHAPTERS.flatMap(chapter=>chapter.levels),LEVELS);
  assert.deepEqual(LEVELS.map(l=>l.id),['neighborhood','demolition-school','avenue-school','cut-school','woodland','growing-city','signal-school','multi-route-school','rush-hour','bus-school']);
  for(const id of ['bridge-school','riverside']) assert.throws(()=>new City(id),RangeError);
  const names=['grade','load','cut','inspect','signals','bus'];
  assert.equal(LEVELS.find(level=>level.id==='cut-school').features.cut,true,'scissors must be available from lesson four');
  assert.equal(LEVELS.find(level=>level.id==='woodland').features.signals,true,'signals must be available from lesson five');
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
test('five-day campaign pays for quality, reveals construction, and replays checkpoints', () => {
  assert.equal(campaignIncome(50,100,80,20),12);
  const campaign=new CampaignSession('growing-city');
  assert.equal(campaign.days.length,5);assert.equal(campaign.city.pendingBuildings.size,8);
  assert.equal(campaign.city.pendingBuildings.get(49).daysUntil,1);
  assert.match(campaign.city.edit(49),/建设用地/);
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

test('five-day campaign has an efficient affordable plan for every new demand wave', () => {
  const campaign=new CampaignSession('growing-city');
  for(let day=0;day<5;day++) {
    line(campaign.city,1,1+day*2,14,1+day*2,0);
    if(day) for(const cell of campaign.city.roads) if(Math.floor(cell/WIDTH)<1+day*2) assert.equal(campaign.city.edit(cell,false,1),'');
    assert.ok(campaign.city.remaining>=0);assert.equal(campaign.beginDay(),'');
    for(let step=0;step<(campaign.city.duration+1)*20;step++) campaign.city.step(.05);
    assert.equal(campaign.city.state,'won',`day ${day+1}: ${campaign.city.delivered}/${campaign.city.target}`);
    if(day<4) campaign.advance(100);
  }
});

module.exports = { buildReferencePlan };
