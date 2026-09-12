'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasTools, calculateFocusView } = require('../src/game/game-canvas.js');

test('campaign view focuses active cells while keeping the map within the viewport', () => {
  const focus=calculateFocusView({mapWidth:16,mapHeight:12,viewportWidth:800,viewportHeight:600,cells:[17,18,33,34]});
  assert.equal(focus.zoom,2.25);
  assert.equal(focus.cellSize,112.5);
  assert.ok(focus.x<=0&&focus.y<=0);
  assert.ok(focus.x+16*focus.cellSize>=800&&focus.y+12*focus.cellSize>=600);
  const full=calculateFocusView({mapWidth:16,mapHeight:12,viewportWidth:800,viewportHeight:600,cells:[]});
  assert.deepEqual(full,{zoom:1,cellSize:50,x:0,y:0});
});

test('canvas tools draw primitives and connected bus segments on the provided context', () => {
  const calls = [];
  const ctx = new Proxy({
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {}, roundRect() {}, closePath() {}, quadraticCurveTo() {}, bezierCurveTo() {}, setLineDash() {}, fillText(text) { calls.push(text); }
  }, { set(target, key, value) { target[key] = value;return true; } });
  const point = cell => ({ x: cell % 4, y: Math.floor(cell / 4) });
  const tools = createCanvasTools(ctx, point);
  tools.rounded(0, 0, 10, 10, 2, '#fff', '#000');
  tools.circle(5, 5, 2, '#000');
  tools.label('测试', 5, 5, 12, '#000');
  tools.drawBusRoute([0, 1, 5], '#1686a0', 2, 20);
  assert.deepEqual(calls, ['测试']);
  assert.deepEqual(tools.busSegment(0, 1, 20), { x1: 10, y1: 12.6, x2: 30, y2: 12.6, dx: 1, dy: 0 });
});
