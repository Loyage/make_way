'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { City, LEVELS, WIDTH, HEIGHT, neighbors } = require('../core.js');

// Deterministic test-only reference planner: minimize new road cost, then distance.
function buildReferencePlan(city) {
  for (const route of city.routes) {
    const costs = new Map([[route.home, 0]]), prev = new Map(), pending = new Set([route.home]);
    while (pending.size) {
      const n = [...pending].reduce((a,b) => costs.get(a) <= costs.get(b) ? a : b);
      pending.delete(n);
      if (n === route.goal) break;
      for (const next of neighbors(n)) {
        if (next !== route.goal && (city.buildings.has(next) || city.trees.has(next) || city.water.has(next) && !city.bridges.has(next))) continue;
        const cost = costs.get(n) + (city.roads.has(next) || next === route.goal ? 0.1 : 1);
        if (!costs.has(next) || cost < costs.get(next)) { costs.set(next,cost);prev.set(next,n);pending.add(next); }
      }
    }
    assert.ok(prev.has(route.goal), `${city.level.id}: disconnected terrain`);
    let n = route.goal;
    while (n !== route.home) { const before=prev.get(n);assert.equal(city.connect(before,n), '', `${city.level.id}: budget exceeded`);n=before; }
  }
  // Dense shared routes can opt into signals instead of default yielding.
  for(const n of city.signals.keys()) city.setSignal(n,true);
}
for (const level of LEVELS) {
  test(`${level.name}: valid independent terrain and dynamic route counts`, () => {
    const city = new City(level.id);
    const buildings = city.routes.flatMap(r => [r.home,r.goal]);
    assert.equal(new Set(buildings).size,buildings.length);
    for (const n of [...level.water,...level.bridges,...level.trees,...buildings]) assert.ok(Number.isInteger(n)&&n>=0&&n<WIDTH*HEIGHT);
    for (const n of buildings) assert.ok(!city.water.has(n)&&!city.trees.has(n));
    for (const n of city.trees) assert.ok(!city.water.has(n));
    for (const n of city.bridges) assert.ok(city.water.has(n));
    assert.equal(city.queues.length,level.routes.length);assert.equal(city.remaining,level.budget);
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
    const city = new City(level.id);city.toggle();
    for(let i=0;i<(level.duration+1)*20;i++)city.step(.05);
    assert.equal(city.state,'lost');assert.equal(city.elapsed,level.duration);
  });
}
test('unknown level is rejected and definitions cannot be accidentally mutated', () => {
  assert.throws(()=>new City('missing'),RangeError);
  assert.throws(()=>{LEVELS[0].budget=999;},TypeError);
});
module.exports = { buildReferencePlan };
