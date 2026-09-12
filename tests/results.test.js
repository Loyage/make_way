'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { satisfactionBand, commuteReport, liveCommuteReport, starReport, bottleneckAdvice } = require('../src/game/game-results.js');
const { crossedProgressMilestones } = require('../src/game/game-effects.js');

test('commute satisfaction groups residents by travel time and weights their score', () => {
  const report = commuteReport([5, 8, 10, 20, 30]);
  assert.deepEqual(report.bands.map(band => band.count), [2, 1, 1, 1]);
  assert.equal(report.score, 74);
  assert.equal(report.average, 14.6);
  assert.equal(report.p95, 30);
});

test('live satisfaction falls as waiting and in-transit commute time grows', () => {
  const report=liveCommuteReport([5],[7,10,20,30]);
  assert.deepEqual(report.bands.map(band=>band.count),[2,1,1,1]);
  assert.equal(report.score,74);
  assert.deepEqual([8,8.01,15.01,25.01].map(satisfactionBand),[0,1,2,3]);
});

test('generated residents who have not arrived count in the lowest satisfaction band', () => {
  const report = commuteReport([5, 10], 3);
  assert.equal(report.count, 5);
  assert.deepEqual(report.bands.map(band => band.count), [1, 1, 0, 3]);
  assert.equal(report.score, 54);
  assert.equal(report.average, 7.5, 'average commute time still describes completed trips');
});

test('three star goals are independent and efficiency requires both limits', () => {
  const targets={satisfaction:80,efficiency:{maxCost:20,maxQueue:5}};
  assert.deepEqual(starReport(targets,{won:false,score:85,cost:18,maxQueue:6}).earned,['satisfaction']);
  assert.deepEqual(starReport(targets,{won:true,score:70,cost:20,maxQueue:5}).earned,['completion','efficiency']);
  assert.equal(starReport(targets,{won:true,score:90,cost:19,maxQueue:4}).count,3);
});

test('delivery celebrations report each newly crossed quarter milestone once', () => {
  assert.deepEqual(crossedProgressMilestones(0,24,100),[]);
  assert.deepEqual(crossedProgressMilestones(24,76,100),[25,50,75]);
  assert.deepEqual(crossedProgressMilestones(50,75,100),[75]);
  assert.deepEqual(crossedProgressMilestones(0,10,0),[]);
});

test('levels without star targets keep star reporting disabled', () => {
  assert.deepEqual(starReport(null,{won:true,score:100,cost:0,maxQueue:0}),{count:0,earned:[],goals:[]});
});

test('bottleneck advice is limited, deterministic, and explains measured evidence', () => {
  const advice=bottleneckAdvice({
    routes:[{index:1,name:'蓝线',delivered:8,total:10,cell:20},{index:0,name:'红线',delivered:2,total:10,cell:10}],
    homes:[{cell:10,waitingSeconds:18.5,maxQueue:4}],
    roads:[{cell:11,blockedSeconds:30,occupancySeconds:50}],
    junctions:[{cell:12,queueSeconds:40,maxQueue:5}]
  });
  assert.equal(advice.length,2);
  assert.deepEqual(advice.map(item=>item.kind),['route','home']);
  assert.match(advice[0].text,/红线仅送达 2\/10/);
  assert.match(advice[1].text,/累计等待 18\.5 人秒/);
  assert.deepEqual(bottleneckAdvice(),[]);
});

test('empty and malformed commute samples produce a stable empty report', () => {
  assert.deepEqual(commuteReport([NaN, -1, '5']), {
    count: 0, score: 0, average: 0, p95: 0,
    bands: [
      { max: 8, label: '轻松通勤', satisfaction: 100, count: 0 },
      { max: 15, label: '舒适通勤', satisfaction: 80, count: 0 },
      { max: 25, label: '尚可接受', satisfaction: 60, count: 0 },
      { max: Infinity, label: '漫长等待', satisfaction: 30, count: 0 }
    ]
  });
});
