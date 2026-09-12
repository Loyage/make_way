'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Navigation=require('../src/game/game-navigation.js');

const normal=id=>({id,lesson:`${id} lesson`,features:{grade:false,cut:false,inspect:false,signals:false,bus:false}});

test('level progress distinguishes not started, in progress and complete',()=>{
  const level=normal('one');
  assert.deepEqual(Navigation.levelProgress(level,false,[[]]),{status:'not-started',stars:0,totalStars:3,completed:false});
  assert.equal(Navigation.levelProgress(level,true,[[]]).status,'in-progress');
  assert.deepEqual(Navigation.levelProgress(level,false,[['completion','satisfaction']]),{status:'completed',stars:2,totalStars:3,completed:true});
  const campaign={...normal('days'),campaign:{days:[{},{}]}};
  assert.equal(Navigation.levelProgress(campaign,true,[['completion'],['satisfaction']]).status,'in-progress');
  assert.equal(Navigation.levelProgress(campaign,true,[['completion'],['completion']]).status,'completed');
});

test('recommendation favors recent unfinished work then first unfinished lesson',()=>{
  const levels=[normal('one'),normal('two'),normal('three')],progress={one:{status:'completed',completed:true},two:{status:'in-progress',completed:false},three:{status:'not-started',completed:false}};
  assert.equal(Navigation.recommendedLevel(levels,progress,'two').id,'two');
  assert.equal(Navigation.recommendedLevel(levels,progress,'one').id,'two');
  assert.equal(Navigation.recommendedLevel(levels,{one:{completed:true},two:{completed:true},three:{completed:true}},null).id,'three');
});

test('chapter totals and next lesson summary expose progression without locks',()=>{
  const first=normal('one'),second={...normal('two'),lesson:'升级道路',features:{grade:true}},chapter={levels:[first,second]};
  assert.deepEqual(Navigation.chapterProgress(chapter,{one:{completed:true,stars:3,totalStars:3},two:{completed:false,stars:1,totalStars:3}}),{completed:1,total:2,stars:4,totalStars:6});
  assert.equal(Navigation.lessonSummary(first,second),'将学习：道路升级与负荷');
});
