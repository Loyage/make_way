'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/shared/core.js');
const Sharing = require('../src/game/game-design-sharing.js');
const { buildReferencePlan } = require('./reference-plan.cjs');

function verifier(levelId) { return new Core.City(levelId); }

test('versioned JSON and text share codes round-trip a complete design', () => {
  const source=new Core.City('bus-school');buildReferencePlan(source);
  const expected=source.serializeDesign(),json=Sharing.json(expected),code=Sharing.code(expected);
  assert.match(json,/"format": "traffic-game-design"/);assert.ok(code.startsWith(Sharing.CODE_PREFIX));
  for(const input of [json,code]){
    const target=verifier(expected.levelId),inspected=Sharing.inspect(input,target);
    assert.deepEqual(inspected.envelope.design,expected);
    assert.deepEqual(target.serializeDesign(),expected);
    assert.equal(inspected.summary.levelId,'bus-school');
    assert.equal(inspected.summary.roadCount,expected.roads.length);
    assert.equal(inspected.summary.busLineCount,expected.busLines.length);
    assert.equal(inspected.summary.cost,source.budget-source.remaining);
  }
});

test('legacy designs migrate inside a current version share envelope', () => {
  const old={version:1,levelId:'neighborhood',roads:[],signals:[]};
  const inspected=Sharing.inspect(JSON.stringify(Sharing.envelope(old)),verifier('neighborhood'));
  assert.equal(inspected.envelope.design.version,8);
  assert.deepEqual(inspected.envelope.design.busLines,[]);
});

test('damaged and malicious imports are rejected without changing the active city', () => {
  const active=new Core.City('neighborhood');buildReferencePlan(active);const before=active.serializeDesign();
  const valid=Sharing.envelope(before),cases=[
    '', '{bad', 'MWD1.not_base64!',
    JSON.stringify(before),
    JSON.stringify({...valid,score:999}),
    JSON.stringify({...valid,version:99}),
    JSON.stringify({...valid,design:{...before,levelId:'missing-level'}}),
    JSON.stringify({...valid,design:{...before,roads:[...before.roads,{cell:-1,grade:0}]}})
  ];
  for(const input of cases){
    assert.throws(()=>{const parsed=Sharing.parse(input),candidate=verifier(parsed.design.levelId);Sharing.inspect(input,candidate);});
    assert.deepEqual(active.serializeDesign(),before);
  }
});
