'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Tutorial=require('../src/game/game-tutorial.js');

test('first lesson guide advances only after each player action',()=>{
  const base={levelId:'neighborhood',usedRoad:false,connected:false,inspected:false,started:false};
  assert.equal(Tutorial.firstStep(base).id,'tool');
  assert.equal(Tutorial.firstStep({...base,usedRoad:true}).id,'connect');
  assert.equal(Tutorial.firstStep({...base,usedRoad:true,connected:true}).id,'inspect');
  assert.equal(Tutorial.firstStep({...base,usedRoad:true,connected:true,inspected:true}).id,'start');
  assert.equal(Tutorial.firstStep({...base,started:true}),null);
  assert.equal(Tutorial.firstStep({...base,levelId:'avenue-school'}),null);
});

test('new mechanic prompts appear once in teaching order',()=>{
  const level={features:{grade:true,cut:true,signals:true,bus:true}};
  assert.equal(Tutorial.unseenMechanic(level,[]).id,'grade');
  assert.equal(Tutorial.unseenMechanic(level,['grade']).id,'cut');
  assert.equal(Tutorial.unseenMechanic(level,['grade','cut']).id,'signals');
  assert.equal(Tutorial.unseenMechanic(level,['grade','cut','signals']).id,'bus');
  assert.equal(Tutorial.unseenMechanic(level,Tutorial.MECHANICS.map(item=>item.id)),null);
  assert.equal(Tutorial.currentMechanic(level).id,'bus');
});
