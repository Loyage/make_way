'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { City, LEVELS, WIDTH, HEIGHT } = require('../core.js');

const { buildReferencePlan } = require('./reference-plan.cjs');
for (const level of LEVELS) {
  test(`${level.name}: valid independent terrain and dynamic route counts`, () => {
    const city = new City(level.id);
    const buildings = [...city.homes.map(h => h.cell), ...city.goals.map(g => g.cell)];
    assert.equal(new Set(buildings).size, buildings.length);
    for (const n of [...level.water,...level.bridges,...level.trees,...buildings]) assert.ok(Number.isInteger(n)&&n>=0&&n<WIDTH*HEIGHT);
    for (const n of buildings) assert.ok(!city.water.has(n)&&!city.trees.has(n));
    for (const n of city.trees) assert.ok(!city.water.has(n));
    for (const n of city.bridges) assert.ok(city.water.has(n));
    assert.equal(city.queues.length,city.homes.length);assert.equal(city.remaining,level.budget-[...city.roads].reduce((sum,n)=>sum+(city.bridges.has(n)?0:1)+(city.roadGrades.get(n)||0),0));
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
    assert.equal(city.state,'won',`${city.delivered}/${level.target}, roads ${level.budget-city.remaining}, deliveries ${city.byRoute}`);
    assert.ok(city.byRoute.every(n=>n>0));assert.ok(city.remaining>=0);
  });
  test(`${level.name}: isolated demand loses at its own deadline`, () => {
    const city = new City(level.id);city.edges.clear();city.refreshPaths();city.toggle();
    for(let i=0;i<(level.duration+1)*20;i++)city.step(.05);
    assert.equal(city.state,'lost');assert.equal(city.elapsed,level.duration);
  });
}
test('seven levels unlock tools progressively and definitions stay immutable', () => {
  assert.deepEqual(LEVELS.map(l=>l.id),['neighborhood','demolition-school','avenue-school','woodland','signal-school','multi-route-school','rush-hour']);
  for(const id of ['bridge-school','riverside','cut-school']) assert.throws(()=>new City(id),RangeError);
  const names=['grade','load','cut','inspect','signals'];
  assert.equal(LEVELS[3].features.signals,true,'signals must be available from lesson four');
  for(const name of names) {
    const values=LEVELS.map(level=>level.features[name]);
    assert.ok(values.includes(false)&&values.includes(true),`${name} must be taught`);
    assert.equal(values.join('').includes('truefalse'),false,`${name} cannot relock`);
  }
  const multi = LEVELS.find(level => level.id === 'multi-route-school').routes[0];
  assert.equal(multi.homes.length, 2);
  assert.equal(multi.goals.length, 2);
  assert.ok(multi.goals.every(goal => goal.input === 60));
  for (const id of ['signal-school','rush-hour']) {
    const routes = LEVELS.find(level => level.id === id).routes;
    assert.ok(routes.some(route => route.homes.length > 1 && route.goals.length > 1), `${id} should reuse multi-point demand`);
  }
  assert.throws(()=>new City('missing'),RangeError);
  assert.throws(()=>{LEVELS[0].budget=999;},TypeError);
});
module.exports = { buildReferencePlan };
