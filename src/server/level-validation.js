'use strict';
// Structural and gameplay validation shared by the administrator API and tests.
const { WIDTH, HEIGHT, MIN_MAP_SIZE, MAX_MAP_SIZE, neighbors, ROAD_TYPES, materializeCampaignRoutes } = require('../shared/core.js');
const { normalizeCatalog } = require('../shared/level-catalog.js');

function isCoord(n, width = WIDTH, height = HEIGHT) { return Number.isInteger(n) && n >= 0 && n < width * height; }
function validateLevels(data) {
  const catalog = normalizeCatalog(data);
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.chapters) || !catalog.chapters.length) return '章节数据必须包含非空 chapters 数组';
  const chapterIds = new Set();
  for (const chapter of catalog.chapters) {
    if (!chapter || typeof chapter.id !== 'string' || !/^[a-z0-9-]+$/.test(chapter.id)) return '章节 id 只能包含小写字母、数字和连字符';
    if (chapterIds.has(chapter.id)) return `章节 id 重复：${chapter.id}`;
    chapterIds.add(chapter.id);
    if (typeof chapter.name !== 'string' || !chapter.name.trim()) return `章节「${chapter.id}」缺少名称`;
    if (typeof chapter.english !== 'string' || !chapter.english.trim()) return `章节「${chapter.id}」缺少英文名`;
    if (!Array.isArray(chapter.levels)) return `章节「${chapter.id}」的 levels 必须是数组`;
  }
  const list = catalog.chapters.flatMap(chapter => chapter.levels);
  if (!list.length) return '至少需要一个关卡';
  const ids = new Set();
  for (const level of list) {
    if (!level || typeof level !== 'object') return '每个关卡都必须是对象';
    // id / names
    if (typeof level.id !== 'string' || !/^[a-z0-9-]+$/.test(level.id)) return '关卡 id 只能包含小写字母、数字和连字符';
    if (ids.has(level.id)) return `关卡 id 重复：${level.id}`;
    ids.add(level.id);
    for (const field of ['name', 'english', 'difficulty', 'title', 'description', 'tip', 'lesson']) {
      if (typeof level[field] !== 'string' || !level[field].trim()) return `关卡「${level.id}」缺少 ${field}`;
    }
    // map and scalar parameters. Missing dimensions retain legacy 16 × 12 behavior.
    const width = level.width ?? WIDTH, height = level.height ?? HEIGHT;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < MIN_MAP_SIZE || width > MAX_MAP_SIZE || height < MIN_MAP_SIZE || height > MAX_MAP_SIZE) return `关卡「${level.id}」的地图宽高必须是 ${MIN_MAP_SIZE} 至 ${MAX_MAP_SIZE} 的整数`;
    if (!Number.isInteger(level.budget) || level.budget < 1) return `关卡「${level.id}」的预算无效`;
    if (!Number.isFinite(level.duration) || level.duration < 1) return `关卡「${level.id}」的时长无效`;
    // features
    const features = level.features || {};
    for (const name of ['grade', 'load', 'cut', 'inspect', 'signals']) {
      if (typeof features[name] !== 'boolean') return `关卡「${level.id}」的 features.${name} 必须是布尔值`;
    }
    if (features.bus !== undefined && typeof features.bus !== 'boolean') return `关卡「${level.id}」的 features.bus 必须是布尔值`;
    if (level.busLineLimit !== undefined && (!Number.isInteger(level.busLineLimit) || level.busLineLimit < 1 || level.busLineLimit > 6)) return `关卡「${level.id}」的 busLineLimit 必须是 1 至 6 的整数`;
    // terrain sets
    for (const field of ['water', 'bridges', 'trees']) {
      if (!Array.isArray(level[field])) return `关卡「${level.id}」的 ${field} 必须是数组`;
      const set = new Set();
      for (const n of level[field]) {
        if (!isCoord(n, width, height)) return `关卡「${level.id}」的 ${field} 包含越界坐标 ${n}`;
        if (set.has(n)) return `关卡「${level.id}」的 ${field} 包含重复坐标 ${n}`;
        set.add(n);
      }
    }
    for (const n of level.bridges) if (!level.water.includes(n)) return `关卡「${level.id}」的桥梁 ${n} 必须位于水面上`;
    for (const n of level.trees) if (level.water.includes(n)) return `关卡「${level.id}」的树木与水体重叠于 ${n}`;
    // routes
    if (!Array.isArray(level.routes) || level.routes.length === 0) return `关卡「${level.id}」至少需要一条路线`;
    for (const route of level.routes) {
      if (!route || typeof route !== 'object') return `关卡「${level.id}」的路线必须是对象`;
      if (typeof route.name !== 'string' || !route.name.trim()) return `关卡「${level.id}」的路线缺少 name`;
      if (typeof route.color !== 'string' || typeof route.light !== 'string') return `关卡「${level.id}」的路线缺少 color/light`;
      if (!Array.isArray(route.homes) || route.homes.length === 0) return `关卡「${level.id}」的路线至少需要一个住宅 (homes)`;
      if (!Array.isArray(route.goals) || route.goals.length === 0) return `关卡「${level.id}」的路线至少需要一个目的地 (goals)`;
      for (const h of route.homes) {
        if (!h || typeof h !== 'object' || !isCoord(h.cell, width, height)) return `关卡「${level.id}」的路线 homes 坐标越界`;
        const generationRate = h.generationRate ?? h.rate;
        if (!Number.isFinite(generationRate) || generationRate <= 0) return `关卡「${level.id}」的路线 homes.generationRate 无效`;
        if (!Number.isInteger(h.passengers) || h.passengers <= 0) return `关卡「${level.id}」的路线 homes.passengers 无效`;
      }
      for (const g of route.goals) {
        if (!g || typeof g !== 'object' || !isCoord(g.cell, width, height)) return `关卡「${level.id}」的路线 goals 坐标越界`;
        if (typeof g.label !== 'string' || !g.label.trim()) return `关卡「${level.id}」的路线 goals.label 无效`;
        if (g.input != null && (!Number.isInteger(g.input) || g.input <= 0)) return `关卡「${level.id}」的路线 goals.input 无效`;
      }
      if (route.homes.some(h => route.goals.some(g => h.cell === g.cell))) return `关卡「${level.id}」的路线住宅与目的地位于同一格`;
      const homeCells = route.homes.map(h => h.cell);
      const goalCells = route.goals.map(g => g.cell);
      if (new Set(homeCells).size !== homeCells.length) return `关卡「${level.id}」的路线存在重叠的住宅`;
      if (new Set(goalCells).size !== goalCells.length) return `关卡「${level.id}」的路线存在重叠的目的地`;
    }
    // Buildings of different routes must not share a cell (a cell hosts one building).
    const buildingRoute = new Map();
    for (let ri = 0; ri < level.routes.length; ri++) {
      for (const h of level.routes[ri].homes) {
        if (buildingRoute.has(h.cell)) return `关卡「${level.id}」的住宅 ${h.cell} 与其他路线建筑重叠`;
        buildingRoute.set(h.cell, ri);
      }
      for (const g of level.routes[ri].goals) {
        if (buildingRoute.has(g.cell)) return `关卡「${level.id}」的目的地 ${g.cell} 与其他路线建筑重叠`;
        buildingRoute.set(g.cell, ri);
      }
    }
    const population = level.routes.reduce((sum, route) => sum + route.homes.reduce((total, home) => total + home.passengers, 0), 0);
    const deliverable = level.routes.reduce((sum, route) => {
      const passengers = route.homes.reduce((total, home) => total + home.passengers, 0);
      const capacity = route.goals.some(goal => goal.input == null) ? Infinity : route.goals.reduce((total, goal) => total + goal.input, 0);
      return sum + Math.min(passengers, capacity);
    }, 0);
    if (population > deliverable) return `关卡「${level.id}」的住宅总人口 ${population} 超过目的地最多可接收人数 ${deliverable}`;
    // homes/goals must not sit on water or trees
    const forbidden = new Set([...level.water, ...level.trees]);
    for (const route of level.routes) {
      for (const h of route.homes) if (forbidden.has(h.cell)) return `关卡「${level.id}」的住宅 ${h.cell} 位于水面或树木上`;
      for (const g of route.goals) if (forbidden.has(g.cell)) return `关卡「${level.id}」的目的地 ${g.cell} 位于水面或树木上`;
    }
    // initialEdges
    if (level.initialEdges !== undefined && level.initialEdges !== null) {
      if (!Array.isArray(level.initialEdges)) return `关卡「${level.id}」的 initialEdges 必须是数组`;
      const seen = new Set(), roadGrades = new Map();
      for (const edge of level.initialEdges) {
        if (!Array.isArray(edge) || edge.length !== 3) return `关卡「${level.id}」的 initialEdges 每项须为 [a,b,grade]`;
        const [a, b, grade] = edge;
        if (!isCoord(a, width, height) || !isCoord(b, width, height) || !neighbors(a, width, height).includes(b)) return `关卡「${level.id}」的 initialEdges 包含非相邻连接`;
        if (!Number.isInteger(grade) || !ROAD_TYPES[grade]) return `关卡「${level.id}」的 initialEdges 道路等级无效`;
        const id = `${Math.min(a, b)}:${Math.max(a, b)}`;
        if (seen.has(id)) return `关卡「${level.id}」的 initialEdges 包含重复连接`;
        if (buildingRoute.has(a) && buildingRoute.has(b)) return `关卡「${level.id}」的 initialEdges 不能直接连接两座建筑`;
        for (const cell of [a,b]) if (!buildingRoute.has(cell)) {
          if (level.trees.includes(cell) || level.water.includes(cell) && !level.bridges.includes(cell)) return `关卡「${level.id}」的初始道路 ${cell} 位于不可建设地形`;
          // Initial edges are applied in order; later edges may repaint a shared
          // road cell, matching City.connect() during level construction.
          roadGrades.set(cell, grade);
        }
        seen.add(id);
      }
      const initialCost = [...roadGrades].reduce((sum, [,grade]) => sum + ROAD_TYPES[grade].cost, 0);
      if (initialCost > level.budget) return `关卡「${level.id}」的初始道路需要 ${initialCost} 点，超过预算 ${level.budget}`;
    }
    if (level.campaign !== undefined) {
      if (!level.campaign || !Array.isArray(level.campaign.days) || level.campaign.days.length < 2 || level.campaign.days.length > 30) return `关卡「${level.id}」的多日任务天数必须为 2 至 30 天`;
      const legacy = level.campaign.days.some(day => Array.isArray(day?.routes));
      for (let dayIndex = 0; dayIndex < level.campaign.days.length; dayIndex++) {
        const day = level.campaign.days[dayIndex];
        if (!day || !Number.isFinite(day.duration) || day.duration < 1) return `关卡「${level.id}」第 ${dayIndex + 1} 天的时长无效`;
        if (!Number.isInteger(day.maxIncome) || day.maxIncome < 0) return `关卡「${level.id}」第 ${dayIndex + 1} 天的最高收入无效`;
        if (legacy) {
          if (!Array.isArray(day.routes)) return `关卡「${level.id}」不能混用新旧多日任务格式`;
          const dayLevel = { ...level, duration: day.duration, routes: day.routes };
          delete dayLevel.campaign;
          const dayError = validateLevels({ version: 1, chapters: [{ id: 'campaign-check', name: '多日任务校验', english: 'CAMPAIGN CHECK', levels: [dayLevel] }] });
          if (dayError) return `关卡「${level.id}」第 ${dayIndex + 1} 天：${dayError}`;
        } else if (day.routes !== undefined) return `关卡「${level.id}」不能混用新旧多日任务格式`;
      }
      const firstDay = level.campaign.days[0];
      if (level.duration !== firstDay.duration) return `关卡「${level.id}」的基础时长必须与第 1 天一致`;
      if (legacy) {
        if (JSON.stringify(level.routes) !== JSON.stringify(firstDay.routes)) return `关卡「${level.id}」的基础路线必须与第 1 天一致`;
        const firstCells = new Set(firstDay.routes.flatMap(route => [...route.homes, ...route.goals].map(building => building.cell)));
        const futureCells = new Set(level.campaign.days.slice(1).flatMap(day => day.routes).flatMap(route => [...route.homes, ...route.goals].map(building => building.cell)).filter(cell => !firstCells.has(cell)));
        for (const edge of level.initialEdges || []) if (futureCells.has(edge[0]) || futureCells.has(edge[1])) return `关卡「${level.id}」的初始道路占用了未来建筑工地`;
      } else {
        const validateCondition = (condition, label) => {
          if (!condition || typeof condition !== 'object') return `${label}缺少条件`;
          if (condition.day !== undefined && (!Number.isInteger(condition.day) || condition.day < 1 || condition.day > level.campaign.days.length)) return `${label}的日期条件无效`;
          for (const field of ['delivered','income']) if (condition[field] !== undefined && (!Number.isInteger(condition[field]) || condition[field] < 0)) return `${label}的 ${field} 条件无效`;
          if (condition.satisfaction !== undefined && (!Number.isFinite(condition.satisfaction) || condition.satisfaction < 0 || condition.satisfaction > 100)) return `${label}的满意度条件无效`;
          return '';
        };
        if (!Array.isArray(level.campaign.routes) || !level.campaign.routes.length) return `关卡「${level.id}」的多日任务必须包含潜在路线`;
        const potentialLevel={...level,routes:level.campaign.routes};delete potentialLevel.campaign;
        const potentialError=validateLevels({version:1,chapters:[{id:'campaign-potential',name:'多日任务校验',english:'CAMPAIGN CHECK',levels:[potentialLevel]}]});
        if(potentialError)return `关卡「${level.id}」的潜在建筑：${potentialError}`;
        for (const route of level.campaign.routes) for (const [kind, buildings] of [['住宅',route.homes],['工作单位',route.goals]]) for (const building of buildings) {
          let error=validateCondition(building.unlock,`${kind} ${building.cell} 的解锁`);if(error)return `关卡「${level.id}」${error}`;
          if (!Array.isArray(building.upgrades)) return `关卡「${level.id}」${kind} ${building.cell} 的 upgrades 必须是数组`;
          for (const upgrade of building.upgrades) {
            error=validateCondition(upgrade.condition,`${kind} ${building.cell} 的升级`);if(error)return `关卡「${level.id}」${error}`;
            if (kind==='住宅' && ((upgrade.generationRate === undefined && upgrade.passengers === undefined) || (upgrade.generationRate !== undefined && (!Number.isFinite(upgrade.generationRate) || upgrade.generationRate <= 0)) || (upgrade.passengers !== undefined && (!Number.isInteger(upgrade.passengers) || upgrade.passengers <= 0)))) return `关卡「${level.id}」住宅 ${building.cell} 的升级参数无效`;
            if (kind==='工作单位' && (!Object.hasOwn(upgrade,'input') || upgrade.input !== null && (!Number.isInteger(upgrade.input) || upgrade.input <= 0))) return `关卡「${level.id}」工作单位 ${building.cell} 的升级输入上限无效`;
          }
        }
        const firstRoutes=materializeCampaignRoutes(level,0,[]);
        if (!firstRoutes.length) return `关卡「${level.id}」第 1 天至少需要一条已解锁的完整路线`;
        if (JSON.stringify(level.routes)!==JSON.stringify(firstRoutes)) return `关卡「${level.id}」的基础路线必须与第 1 天已解锁路线一致`;
        const firstCells=new Set(firstRoutes.flatMap(route=>[...route.homes,...route.goals].map(building=>building.cell)));
        const pendingCells=new Set(level.campaign.routes.flatMap(route=>[...route.homes,...route.goals]).map(building=>building.cell).filter(cell=>!firstCells.has(cell)));
        for (const edge of level.initialEdges || []) if (pendingCells.has(edge[0]) || pendingCells.has(edge[1])) return `关卡「${level.id}」的初始道路占用了未解锁建筑工地`;
      }
    }
  }
  return '';
}

module.exports = { validateLevels };
