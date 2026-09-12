(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrafficGameStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PROGRESS_KEY = 'traffic-game-progress-v1';

  function createSnapshot(city, campaign, mode) {
    if (!city || city.state !== 'planning') return null;
    if (!['challenge','sandbox'].includes(mode)) throw new Error('游戏模式无效');
    return {
      version: 1,
      levelId: city.level.id,
      mode,
      design: campaign ? null : city.serializeDesign(),
      campaign: campaign ? campaign.serializeProgress() : null,
      sandbox: mode === 'sandbox' ? {
        budgetMode: city.unlimitedBudget ? 'unlimited' : 'level',
        demandMultiplier: city.demandMultiplier,
        continuousDemand: city.continuousDemand
      } : null
    };
  }

  function restoreSnapshot(saved, core) {
    if (!saved || saved.version !== 1 || typeof saved.levelId !== 'string' || !['challenge','sandbox'].includes(saved.mode)
      || !core?.LEVELS?.some(level=>level.id===saved.levelId)) throw new Error('进度存档格式无效');
    const sandbox=saved.sandbox??(saved.mode==='sandbox'?{budgetMode:'level',demandMultiplier:1,continuousDemand:false}:null);
    if(saved.mode==='sandbox'&&(!sandbox||!['level','unlimited'].includes(sandbox.budgetMode)||!Number.isFinite(sandbox.demandMultiplier)||sandbox.demandMultiplier<=0||sandbox.demandMultiplier>10||typeof sandbox.continuousDemand!=='boolean'))throw new Error('沙盒实验参数无效');
    if(saved.mode==='challenge'&&saved.sandbox!=null)throw new Error('挑战进度不能包含沙盒参数');
    if (saved.campaign !== null) {
      if (saved.mode !== 'challenge' || !saved.campaign || saved.campaign.levelId !== saved.levelId || saved.design !== null) throw new Error('多日进度存档格式无效');
      const campaign=core.CampaignSession.restoreProgress(saved.campaign);
      return { mode: saved.mode, city: campaign.city, campaign };
    }
    if (!saved.design || saved.design.levelId !== saved.levelId) throw new Error('规划草稿格式无效');
    const city=new core.City(saved.levelId,{sandbox:saved.mode==='sandbox',unlimitedBudget:sandbox?.budgetMode==='unlimited',demandMultiplier:sandbox?.demandMultiplier,continuousDemand:sandbox?.continuousDemand}),message=city.loadDesign(saved.design);
    if(message)throw new Error(message);
    return { mode: saved.mode, city, campaign: null };
  }

  function read(storage) {
    let raw;
    try { raw=storage.getItem(PROGRESS_KEY); }
    catch { return { snapshot:null, error:'无法读取浏览器进度' }; }
    if(raw===null)return {snapshot:null,error:''};
    try { return {snapshot:JSON.parse(raw),error:''}; }
    catch { return {snapshot:null,error:'进度存档已损坏' }; }
  }
  function write(storage, snapshot) {
    try { storage.setItem(PROGRESS_KEY,JSON.stringify(snapshot));return ''; }
    catch { return '无法保存进度，请检查浏览器存储权限'; }
  }
  function clear(storage) {
    try { storage.removeItem(PROGRESS_KEY);return ''; }
    catch { return '无法清除浏览器进度'; }
  }
  return { PROGRESS_KEY, createSnapshot, restoreSnapshot, read, write, clear };
});
