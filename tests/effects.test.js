'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { drawResidentMood, createArrivalEffects } = require('../src/game/game-effects.js');

test('arrival celebration is drawn at the destination recorded by the vehicle', () => {
  const effects=createArrivalEffects(),visited=[],arcs=[];
  const city={
    delivered:1,
    arrivals:[{route:0,goal:42,goalIndex:1}],
    routes:[{color:'#37678c',goals:[{cell:7},{cell:42}]}],
    goals:[{cell:7},{cell:42}]
  };
  effects.sync(city);
  const ctx={beginPath(){},arc(...args){arcs.push(args);},fill(){},globalAlpha:1,fillStyle:''};
  effects.draw(ctx,n=>{visited.push(n);return {x:n%16,y:Math.floor(n/16)};},40);
  assert.deepEqual(visited,[42,42,42,42,42,42,42]);
  assert.equal(arcs.length,7);
  assert.ok(arcs.every(args=>args.every(Number.isFinite)));
});

test('resident mood draws a colored face and passenger-count badge', () => {
  const text=[],arcs=[];
  const ctx={save(){},restore(){},beginPath(){},arc(...args){arcs.push(args);},fill(){},stroke(){},fillText(value){text.push(value);}};
  drawResidentMood(ctx,20,30,40,3,12,2);
  assert.deepEqual(text,['☹','12']);
  assert.equal(arcs.length,2);
  assert.ok(arcs.flat().every(Number.isFinite));
});

test('arrival celebration supports normalized route goals as a fallback', () => {
  const effects=createArrivalEffects(),visited=[];
  effects.sync({delivered:1,arrivals:[{route:0}],routes:[{color:'#37678c',goals:[{cell:23}]}]});
  const ctx={beginPath(){},arc(){},fill(){},globalAlpha:1,fillStyle:''};
  effects.draw(ctx,n=>{visited.push(n);return {x:0,y:0};},40);
  assert.deepEqual(visited,[23,23,23,23,23,23,23]);
});
