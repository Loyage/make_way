'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasTools } = require('../game-canvas.js');

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
