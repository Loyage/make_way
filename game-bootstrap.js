(function (root) {
  'use strict';
  function validateRuntimeCatalog(core) {
    for (const level of core.LEVELS) {
      for (const field of ['name','english','difficulty','title','description','tip','lesson']) {
        if (typeof level[field] !== 'string' || !level[field].trim()) throw new Error(`关卡 ${level.id} 缺少 ${field}`);
      }
      if (!level.features || !Array.isArray(level.routes) || !Number.isFinite(level.budget) || !Number.isFinite(level.duration)) throw new Error(`关卡 ${level.id} 缺少运行参数`);
      new core.City(level.id);
      if (level.campaign) new core.CampaignSession(level.id);
    }
  }

  async function loadActiveCatalog({ core, catalogLoader, defaults = 'built-in-levels.json', override = 'levels.json' }) {
    const builtInCatalog = await catalogLoader.loadCatalog(defaults);
    const builtInMessage = core.setLevels(builtInCatalog);
    if (builtInMessage) throw new Error(`默认关卡数据无效：${builtInMessage}`);
    validateRuntimeCatalog(core);
    try {
      const overrideCatalog = await catalogLoader.loadCatalog(override);
      const overrideMessage = core.setLevels(overrideCatalog);
      if (overrideMessage) throw new Error(overrideMessage);
      validateRuntimeCatalog(core);
    } catch (error) {
      core.setLevels(builtInCatalog);
      if (error.status !== 404) console.warn('忽略 levels.json：' + error.message);
    }
    return builtInCatalog;
  }

  root.TrafficGameBootstrap = { loadActiveCatalog, validateRuntimeCatalog };
})(typeof globalThis !== 'undefined' ? globalThis : this);
