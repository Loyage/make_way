'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { commuteReport } = require('../game-results.js');

test('commute satisfaction groups residents by travel time and weights their score', () => {
  const report = commuteReport([5, 8, 10, 20, 30]);
  assert.deepEqual(report.bands.map(band => band.count), [2, 1, 1, 1]);
  assert.equal(report.score, 74);
  assert.equal(report.average, 14.6);
});

test('empty and malformed commute samples produce a stable empty report', () => {
  assert.deepEqual(commuteReport([NaN, -1, '5']), {
    count: 0, score: 0, average: 0,
    bands: [
      { max: 8, label: '轻松通勤', satisfaction: 100, count: 0 },
      { max: 15, label: '舒适通勤', satisfaction: 80, count: 0 },
      { max: 25, label: '尚可接受', satisfaction: 60, count: 0 },
      { max: Infinity, label: '漫长等待', satisfaction: 30, count: 0 }
    ]
  });
});
