'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { City, WIDTH, HEIGHT, BUDGET, TARGET, ROUTES, key, point, neighbors, findPath } = require('../core.js');
function connect(city) {
  for (let x = 2; x <= 11; x++) city.edit(key(x, 3));
  for (let x = 4; x <= 13; x++) city.edit(key(x, 8));
  for (const [x,y] of [[4,10],[4,9],[12,7]]) city.edit(key(x,y));
}
function run(city, seconds) { for (let i = 0; i < seconds * 20; i++) city.step(.05); }

test('map coordinates and adjacency do not wrap at edges', () => {
  assert.deepEqual(point(key(15,11)), {x:15,y:11});
  assert.deepEqual(neighbors(0), [1,WIDTH]);
  assert.ok(!neighbors(15).includes(16));
  assert.equal(neighbors(WIDTH*HEIGHT-1).length, 2);
});
test('starts in planning mode with fixed bridges and no connections', () => {
  const city = new City();
  assert.equal(city.remaining,BUDGET);assert.equal(city.roads.size,4);
  assert.ok(city.paths.every(p=>p===null));run(city,10);
  assert.equal(city.elapsed,0);assert.equal(city.cars.length,0);
});
test('construction honors terrain, buildings, bridges, and refunds', () => {
  const city = new City();
  for (const n of [key(7,1),key(1,5),ROUTES[0].home]) assert.ok(city.edit(n));
  assert.equal(city.remaining,BUDGET);
  assert.ok(city.edit(key(7,3),true));assert.ok(city.roads.has(key(7,3)));
  city.edit(key(1,1));assert.equal(city.remaining,BUDGET-1);
  city.edit(key(1,1));assert.equal(city.remaining,BUDGET-1);
  city.edit(key(1,1),true);assert.equal(city.remaining,BUDGET);
});
test('cannot exceed road budget', () => {
  const city = new City();
  for(let n=0;n<WIDTH*HEIGHT;n++) city.edit(n);
  assert.equal(city.remaining,0);assert.equal(city.roads.size,BUDGET+4);
});
test('BFS finds shortest four-way route and never traverses unrelated buildings', () => {
  const roads = new Set([key(1,0),key(2,0)]);
  assert.deepEqual(findPath(roads,0,key(3,0)),[0,1,2,3]);
  assert.equal(findPath(roads,0,key(4,0)),null);
  assert.equal(findPath(new Set([key(1,1)]),0,key(2,1)),null);
});
test('a 19-road starter plan connects all routes and wins within the time limit', () => {
  const city = new City();connect(city);
  assert.ok(city.paths.every(Boolean));assert.ok(city.remaining>0);
  city.toggle();run(city,120);
  assert.equal(city.state,'won');assert.ok(city.delivered>=TARGET);
  assert.ok(city.byRoute.every(n=>n>0));assert.ok(city.elapsed<=120);
});
test('pause freezes vehicles, demand and time; resume continues', () => {
  const city = new City();connect(city);city.toggle();run(city,3);city.toggle();
  const snapshot=JSON.stringify(city);run(city,10);assert.equal(JSON.stringify(city),snapshot);
  city.toggle();run(city,1);assert.ok(city.elapsed>3);
});
test('unconnected city loses at the deadline and terminal states do not advance', () => {
  const city = new City();city.toggle();run(city,121);
  assert.equal(city.state,'lost');assert.equal(city.elapsed,120);assert.equal(city.delivered,0);
  const snapshot=JSON.stringify(city);city.toggle();run(city,3);city.edit(key(1,1));
  assert.equal(JSON.stringify(city),snapshot);
});
test('occupied cells and reserved next cells cannot be demolished', () => {
  const city=new City();connect(city);city.toggle();run(city,1);
  const car=city.cars.find(c=>city.roads.has(c.cell));assert.ok(car);
  assert.ok(city.edit(car.cell,true));assert.ok(city.roads.has(car.cell));
  if(car.next!==null&&city.roads.has(car.next)) {assert.ok(city.edit(car.next,true));assert.ok(city.roads.has(car.next));}
});
test('disconnecting and reconnecting roads updates path availability', () => {
  const city=new City();connect(city);
  city.edit(key(5,3),true);assert.equal(city.paths[0],null);
  city.edit(key(5,3));assert.ok(city.paths[0]);
});
test('simulation never moves cars onto deleted roads during live editing', () => {
  const city=new City();connect(city);city.toggle();run(city,1);
  city.edit(key(5,3),true);run(city,8);
  for(const car of city.cars) {
    assert.ok(city.roads.has(car.cell)||city.buildings.has(car.cell));
    assert.ok(car.next===null||city.roads.has(car.next)||city.buildings.has(car.next));
  }
  city.edit(key(5,3));run(city,110);assert.equal(city.state,'won');
});
