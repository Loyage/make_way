'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/shared/core.js');
const Storage = require('../src/game/game-storage.js');
const { buildReferencePlan } = require('./reference-plan.cjs');

function memoryStorage(initial = {}) {
  const values=new Map(Object.entries(initial));
  return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),values};
}

test('automatic progress round-trips a normal challenge and sandbox atomically', () => {
  for(const mode of ['challenge','sandbox']){
    const city=new Core.City('neighborhood',{sandbox:mode==='sandbox',unlimitedBudget:mode==='sandbox',demandMultiplier:mode==='sandbox'?2:1,continuousDemand:mode==='sandbox'});buildReferencePlan(city);
    const snapshot=Storage.createSnapshot(city,null,mode),restored=Storage.restoreSnapshot(snapshot,Core);
    assert.equal(restored.mode,mode);assert.equal(restored.campaign,null);assert.equal(restored.city.sandbox,mode==='sandbox');
    if(mode==='sandbox'){assert.equal(restored.city.unlimitedBudget,true);assert.equal(restored.city.demandMultiplier,2);assert.equal(restored.city.continuousDemand,true);}
    assert.deepEqual(restored.city.serializeDesign(),city.serializeDesign());
  }
  const legacy=Storage.restoreSnapshot({version:1,levelId:'neighborhood',mode:'challenge',campaign:null,design:{version:1,levelId:'neighborhood',roads:[],signals:[]}},Core);
  assert.equal(legacy.city.serializeDesign().version,8,'legacy designs migrate through the existing strict loader');
  const city=new Core.City('neighborhood'),snapshot=Storage.createSnapshot(city,null,'challenge');
  snapshot.design.roads.push({cell:-1,grade:0});
  assert.throws(()=>Storage.restoreSnapshot(snapshot,Core),/道路数据无效/);
  assert.equal(city.roads.size,0,'failed restoration does not partially change the active city');
});

test('multi-day progress restores date, income, regions, spending, design and checkpoints', () => {
  const campaign=new Core.CampaignSession('growing-city');
  const first=campaign.runReferenceDay();assert.equal(first.ok,true);assert.equal(campaign.dayIndex,1);
  for(const region of campaign.availableRegions())assert.equal(campaign.unlockRegion(region.id),'');
  assert.equal(campaign.loadReference(1,true),'');
  const saved=campaign.serializeProgress(),restored=Core.CampaignSession.restoreProgress(saved);
  assert.equal(restored.dayIndex,campaign.dayIndex);assert.deepEqual(restored.results,campaign.results);
  assert.deepEqual([...restored.unlockedRegionIds],[...campaign.unlockedRegionIds]);assert.equal(restored.regionSpent,campaign.regionSpent);
  assert.deepEqual(restored.checkpoints,campaign.checkpoints);assert.deepEqual(restored.city.serializeDesign(),campaign.city.serializeDesign());
  assert.equal(restored.city.budget,campaign.city.budget);assert.equal(restored.city.remaining,campaign.city.remaining);
  assert.equal(restored.replay(0),'');assert.equal(restored.dayIndex,0);
});

test('progress validation rejects corrupt campaign data and storage failures are contained', () => {
  const campaign=new Core.CampaignSession('growing-city'),saved=campaign.serializeProgress();
  for(const mutate of [
    value=>{value.dayIndex=99;},
    value=>{value.unlockedRegionIds=['missing-region'];},
    value=>{value.regionSpent=1;},
    value=>{value.design.levelId='neighborhood';}
  ]){const broken=structuredClone(saved);mutate(broken);assert.throws(()=>Core.CampaignSession.restoreProgress(broken));}
  const storage=memoryStorage({[Storage.PROGRESS_KEY]:'{bad'}),read=Storage.read(storage);
  assert.equal(read.snapshot,null);assert.match(read.error,/损坏/);
  assert.equal(Storage.clear(storage),'');assert.equal(storage.getItem(Storage.PROGRESS_KEY),null);
  const denied={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');},removeItem(){throw new Error('denied');}};
  assert.match(Storage.read(denied).error,/无法读取/);assert.match(Storage.write(denied,saved),/无法保存/);assert.match(Storage.clear(denied),/无法清除/);
});
