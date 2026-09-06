'use strict';
const assert = require('node:assert/strict');
const { key, neighbors } = require('../core.js');
function line(city,x1,y1,x2,y2,grade=0) {
  let x=x1,y=y1;
  while(x!==x2 || y!==y2) {
    const a=key(x,y);if(x!==x2)x+=Math.sign(x2-x);else y+=Math.sign(y2-y);
    assert.equal(city.connect(a,key(x,y),grade),'',`${city.level.id}: connecting ${a} to ${key(x,y)}`);
  }
}
function completeCrossing(city) {
  line(city,5,3,5,10,1);line(city,10,8,10,1,1);line(city,10,1,12,1,1);
}
function buildReferencePlan(city) {
  if(city.level.id==='demolition-school') {
    for(const n of [...city.roads]) assert.equal(city.edit(n,true),'');
    line(city,2,2,2,8);return;
  }
  if(city.level.id==='avenue-school') {
    line(city,2,5,13,5,1);line(city,2,8,13,8,2);return;
  }
  if(city.level.id==='woodland') {
    for(const [x1,y1,x2,y2] of [[2,2,3,2],[3,2,3,3],[12,2,11,2],[11,2,11,3],[13,9,11,9],[11,9,11,8],[3,9,3,8],[2,7,3,7],[12,5,11,5],[13,7,11,7],[4,4,4,3]]) line(city,x1,y1,x2,y2,2);
    return;
  }
  if(city.level.id==='signal-school') {
    completeCrossing(city);
    for(const n of city.signals.keys()) assert.equal(city.setSignal(n,true,4),'');
    return;
  }
  if(city.level.id==='rush-hour') {
    // Keep the two heaviest flows away from junctions; share the middle bridge.
    for(const p of [[2,2,13,2],[13,9,2,9],[3,10,1,10],[1,10,1,8],[1,8,4,8],[4,8,4,6],[2,6,12,6],[12,4,11,4],[11,4,11,6],[6,6,6,4],[6,4,3,4],[9,6,9,7],[9,7,13,7]]) line(city,...p,2);
    for(const n of city.signals.keys()) assert.equal(city.setSignal(n,true,4),'');
    return;
  }
  // Minimize new road cost, then distance; connections always remain explicit.
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
}
module.exports = { buildReferencePlan, completeCrossing, line };
