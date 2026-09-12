(function (root, factory) {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports
    ? factory(require('./core.js'), require('./level-catalog.js'))
    : factory(root.TrafficCore, root.TrafficLevelCatalog);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficLevelValidation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, catalogApi) {
'use strict';
// Pure catalog validation shared by the browser, administrator API and tests.
const { WIDTH, HEIGHT, MIN_MAP_SIZE, MAX_MAP_SIZE, neighbors, ROAD_TYPES, BUS_COST, materializeCampaignRoutes } = core;
const { normalizeCatalog } = catalogApi;

function isCoord(n, width = WIDTH, height = HEIGHT) { return Number.isInteger(n) && n >= 0 && n < width * height; }
function starTargetError(targets) {
  if (!targets || typeof targets !== 'object' || Array.isArray(targets)) return 'starTargets 必须是对象';
  if (!Number.isInteger(targets.satisfaction) || targets.satisfaction < 0 || targets.satisfaction > 100) return 'starTargets.satisfaction 必须是 0 至 100 的整数';
  if (!targets.efficiency || typeof targets.efficiency !== 'object' || Array.isArray(targets.efficiency)) return 'starTargets.efficiency 必须是对象';
  if (!Number.isInteger(targets.efficiency.maxCost) || targets.efficiency.maxCost < 0) return 'starTargets.efficiency.maxCost 必须是非负整数';
  if (!Number.isInteger(targets.efficiency.maxQueue) || targets.efficiency.maxQueue < 0) return 'starTargets.efficiency.maxQueue 必须是非负整数';
  return '';
}
function validateLevelsFirst(data) {
  const catalog = normalizeCatalog(data);
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.chapters) || !catalog.chapters.length) return '章节数据必须包含非空 chapters 数组';
  const chapterIds = new Set();
  for (const chapter of catalog.chapters) {
    if (!chapter || typeof chapter.id !== 'string' || !/^[a-z0-9-]+$/.test(chapter.id)) return '章节 id 只能包含小写字母、数字和连字符';
    if (chapterIds.has(chapter.id)) return `章节 id 重复：${chapter.id}`;
    chapterIds.add(chapter.id);
    if (typeof chapter.name !== 'string' || !chapter.name.trim()) return `章节「${chapter.id}」缺少名称`;
    if (typeof chapter.english !== 'string' || !chapter.english.trim()) return `章节「${chapter.id}」缺少英文名`;
    if (chapter.hidden !== undefined && typeof chapter.hidden !== 'boolean') return `章节「${chapter.id}」的 hidden 必须是布尔值`;
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
    if (level.starTargets !== undefined) { const message=starTargetError(level.starTargets);if(message)return `关卡「${level.id}」的 ${message}`; }
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
    // Initial-road format v2 separates surfaces/grades from explicit edges.
    if (level.initialRoads !== undefined) {
      if (!Array.isArray(level.initialRoads)) return `关卡「${level.id}」的 initialRoads 必须是数组`;
      const roadCells = new Set();let initialCost = 0;
      for (const road of level.initialRoads) {
        if (!road || typeof road !== 'object' || !isCoord(road.cell,width,height)) return `关卡「${level.id}」的 initialRoads.cell 包含越界坐标`;
        if (!Number.isInteger(road.grade) || !ROAD_TYPES[road.grade]) return `关卡「${level.id}」的 initialRoads.grade 道路等级无效`;
        if (roadCells.has(road.cell)) return `关卡「${level.id}」的 initialRoads 包含重复道路格 ${road.cell}`;
        if (buildingRoute.has(road.cell)) return `关卡「${level.id}」的 initialRoads 不能位于建筑格 ${road.cell}`;
        if (level.trees.includes(road.cell) || level.water.includes(road.cell) && !level.bridges.includes(road.cell)) return `关卡「${level.id}」的初始道路 ${road.cell} 位于不可建设地形`;
        roadCells.add(road.cell);initialCost += ROAD_TYPES[road.grade].cost;
      }
      if (!Array.isArray(level.initialEdges)) return `关卡「${level.id}」的 initialEdges 必须是数组`;
      const seen = new Set();
      for (const edge of level.initialEdges) {
        if (!Array.isArray(edge) || edge.length !== 2) return `关卡「${level.id}」格式 v2 的 initialEdges 每项须为 [a,b]`;
        const [a,b] = edge;
        if (!isCoord(a,width,height) || !isCoord(b,width,height) || !neighbors(a,width,height).includes(b)) return `关卡「${level.id}」的 initialEdges 包含非相邻连接`;
        const id=`${Math.min(a,b)}:${Math.max(a,b)}`;
        if(seen.has(id))return `关卡「${level.id}」的 initialEdges 包含重复连接`;
        if(buildingRoute.has(a)&&buildingRoute.has(b))return `关卡「${level.id}」的 initialEdges 不能直接连接两座建筑`;
        for(const cell of [a,b])if(!buildingRoute.has(cell)&&!roadCells.has(cell))return `关卡「${level.id}」的 initialEdges 引用了未在 initialRoads 定义的道路格 ${cell}`;
        seen.add(id);
      }
      if(initialCost>level.budget)return `关卡「${level.id}」的初始道路需要 ${initialCost} 点，超过预算 ${level.budget}`;
    } else if (level.initialEdges !== undefined && level.initialEdges !== null) {
      // Malformed or old data that could not be migrated still gets a precise v1 error.
      if (!Array.isArray(level.initialEdges)) return `关卡「${level.id}」的 initialEdges 必须是数组`;
      const seen = new Set(), roadGrades = new Map();
      for (const edge of level.initialEdges) {
        if (!Array.isArray(edge) || edge.length !== 3) return `关卡「${level.id}」格式 v1 的 initialEdges 每项须为 [a,b,grade]`;
        const [a,b,grade]=edge;
        if(!isCoord(a,width,height)||!isCoord(b,width,height)||!neighbors(a,width,height).includes(b))return `关卡「${level.id}」的 initialEdges 包含非相邻连接`;
        if(!Number.isInteger(grade)||!ROAD_TYPES[grade])return `关卡「${level.id}」的 initialEdges 道路等级无效`;
        const id=`${Math.min(a,b)}:${Math.max(a,b)}`;if(seen.has(id))return `关卡「${level.id}」的 initialEdges 包含重复连接`;
        if(buildingRoute.has(a)&&buildingRoute.has(b))return `关卡「${level.id}」的 initialEdges 不能直接连接两座建筑`;
        for(const cell of [a,b])if(!buildingRoute.has(cell)){if(level.trees.includes(cell)||level.water.includes(cell)&&!level.bridges.includes(cell))return `关卡「${level.id}」的初始道路 ${cell} 位于不可建设地形`;roadGrades.set(cell,grade);}
        seen.add(id);
      }
      const initialCost=[...roadGrades].reduce((sum,[,grade])=>sum+ROAD_TYPES[grade].cost,0);
      if(initialCost>level.budget)return `关卡「${level.id}」的初始道路需要 ${initialCost} 点，超过预算 ${level.budget}`;
    }
    if (level.referenceDesign !== undefined) {
      if (level.campaign) return `关卡「${level.id}」的多日任务必须在 campaign.days[] 中逐日配置 referenceDesign`;
      const design=level.referenceDesign;
      if (!design || design.version!==8 || design.levelId!==level.id || design.width!==width || design.height!==height
        || !Array.isArray(design.roads) || !Array.isArray(design.edges) || !Array.isArray(design.roadPolicies)
        || !Array.isArray(design.signals) || !Array.isArray(design.busLines)) return `关卡「${level.id}」的 referenceDesign 格式无效`;
      const buildings=new Set(buildingRoute.keys()),roadCells=new Set();let designCost=0;
      for(const road of design.roads){
        if(!road||!isCoord(road.cell,width,height)||!Number.isInteger(road.grade)||!ROAD_TYPES[road.grade]||roadCells.has(road.cell)||buildings.has(road.cell)
          ||level.trees.includes(road.cell)||level.water.includes(road.cell)&&!level.bridges.includes(road.cell))return `关卡「${level.id}」的 referenceDesign 道路无效`;
        roadCells.add(road.cell);designCost+=ROAD_TYPES[road.grade].cost;
      }
      const designEdges=new Set(),degree=new Map();
      for(const edge of design.edges){
        if(!Array.isArray(edge)||edge.length!==2)return `关卡「${level.id}」的 referenceDesign 连接无效`;
        const [a,b]=edge,key=`${Math.min(a,b)}:${Math.max(a,b)}`;
        if(!isCoord(a,width,height)||!isCoord(b,width,height)||!neighbors(a,width,height).includes(b)||designEdges.has(key)
          ||![a,b].every(cell=>roadCells.has(cell)||buildings.has(cell))||[a,b].every(cell=>buildings.has(cell)))return `关卡「${level.id}」的 referenceDesign 连接无效`;
        designEdges.add(key);degree.set(a,(degree.get(a)||0)+1);degree.set(b,(degree.get(b)||0)+1);
      }
      const policies=new Set();
      for(const policy of design.roadPolicies)if(!policy||!roadCells.has(policy.cell)||policies.has(policy.cell)||!['prefer','avoid'].includes(policy.policy))return `关卡「${level.id}」的 referenceDesign 道路引导无效`;else policies.add(policy.cell);
      const signalCells=new Set();
      for(const signal of design.signals){
        if(!signal||!roadCells.has(signal.cell)||signalCells.has(signal.cell)||(degree.get(signal.cell)||0)<3||typeof signal.enabled!=='boolean'||![2,4,6].includes(signal.green))return `关卡「${level.id}」的 referenceDesign 信号灯无效`;
        signalCells.add(signal.cell);
      }
      const lineIds=new Set();
      if(design.busLines.length>(level.busLineLimit||1))return `关卡「${level.id}」的 referenceDesign 公交线路超过上限`;
      for(const line of design.busLines){
        if(!line||typeof line.id!=='string'||!/^[a-z0-9-]{1,30}$/i.test(line.id)||lineIds.has(line.id)||typeof line.name!=='string'||!line.name.trim()||line.name.trim().length>20
          ||typeof line.color!=='string'||!/^#[0-9a-f]{6}$/i.test(line.color)||!Number.isInteger(line.count)||line.count<1||line.count>3
          ||!Array.isArray(line.route)||!Array.isArray(line.stops)||typeof line.returnTrip!=='boolean'||typeof line.returnStops!=='boolean'||![2,4,6,8].includes(line.headway))return `关卡「${level.id}」的 referenceDesign 公交线路无效`;
        if(line.route.some(cell=>!roadCells.has(cell))||line.route.some((cell,index)=>index>0&&!designEdges.has(`${Math.min(cell,line.route[index-1])}:${Math.max(cell,line.route[index-1])}`))
          ||line.stops.some(cell=>!roadCells.has(cell)||!line.route.includes(cell))||new Set(line.stops).size!==line.stops.length)return `关卡「${level.id}」的 referenceDesign 公交路径或站点无效`;
        lineIds.add(line.id);designCost+=line.count*BUS_COST;
      }
      if(design.activeBusLineId!==null&&!lineIds.has(design.activeBusLineId))return `关卡「${level.id}」的 referenceDesign 当前公交线路无效`;
      if(designCost>level.budget)return `关卡「${level.id}」的 referenceDesign 需要 ${designCost} 点，超过预算 ${level.budget}`;
    }
    if (level.campaign !== undefined) {
      if (!level.campaign || !Array.isArray(level.campaign.days) || level.campaign.days.length < 2 || level.campaign.days.length > 30) return `关卡「${level.id}」的多日任务天数必须为 2 至 30 天`;
      const legacy = level.campaign.days.some(day => Array.isArray(day?.routes));
      if(!legacy){
        if(!Array.isArray(level.campaign.routes)||!level.campaign.routes.length)return `关卡「${level.id}」的多日任务必须包含潜在路线`;
        const potentialLevel={...level,routes:level.campaign.routes};delete potentialLevel.campaign;
        const potentialError=validateLevelsFirst({version:1,chapters:[{id:'campaign-potential',name:'多日任务校验',english:'CAMPAIGN CHECK',levels:[potentialLevel]}]});
        if(potentialError)return `关卡「${level.id}」的潜在建筑：${potentialError}`;
      }
      let maximumBudget=level.budget;const referenceResults=[];
      for (let dayIndex = 0; dayIndex < level.campaign.days.length; dayIndex++) {
        const day = level.campaign.days[dayIndex];
        if (!day || !Number.isFinite(day.duration) || day.duration < 1) return `关卡「${level.id}」第 ${dayIndex + 1} 天的时长无效`;
        if (!Number.isInteger(day.maxIncome) || day.maxIncome < 0) return `关卡「${level.id}」第 ${dayIndex + 1} 天的最高收入无效`;
        if (day.starTargets !== undefined) { const message=starTargetError(day.starTargets);if(message)return `关卡「${level.id}」第 ${dayIndex + 1} 天的 ${message}`; }
        if (legacy) {
          if (!Array.isArray(day.routes)) return `关卡「${level.id}」不能混用新旧多日任务格式`;
          const dayLevel = { ...level, duration: day.duration, routes: day.routes };
          delete dayLevel.campaign;
          const dayError = validateLevelsFirst({ version: 1, chapters: [{ id: 'campaign-check', name: '多日任务校验', english: 'CAMPAIGN CHECK', levels: [dayLevel] }] });
          if (dayError) return `关卡「${level.id}」第 ${dayIndex + 1} 天：${dayError}`;
        } else if (day.routes !== undefined) return `关卡「${level.id}」不能混用新旧多日任务格式`;
        if(day.referenceDesign!==undefined){
          const referenceRoutes=legacy?day.routes:materializeCampaignRoutes(level,dayIndex,referenceResults),activeCells=new Set(referenceRoutes.flatMap(route=>[...route.homes,...route.goals].map(building=>building.cell)));
          const pendingCells=new Set((level.campaign.routes||[]).flatMap(route=>[...route.homes,...route.goals].map(building=>building.cell)).filter(cell=>!activeCells.has(cell)));
          if(day.referenceDesign.roads?.some(road=>pendingCells.has(road.cell)))return `关卡「${level.id}」第 ${dayIndex+1} 天的参考答案占用了尚未解锁的建筑工地`;
          const referenceLevel={...level,duration:day.duration,budget:maximumBudget,routes:referenceRoutes,referenceDesign:day.referenceDesign};delete referenceLevel.campaign;
          const referenceError=validateLevelsFirst({version:1,chapters:[{id:'campaign-reference',name:'多日参考答案校验',english:'CAMPAIGN REFERENCE',levels:[referenceLevel]}]});
          if(referenceError)return `关卡「${level.id}」第 ${dayIndex+1} 天的参考答案：${referenceError}`;
        }
        maximumBudget+=day.maxIncome;referenceResults.push({delivered:1000000000,income:day.maxIncome,satisfaction:100});
      }
      const firstDay = level.campaign.days[0];
      if (level.duration !== firstDay.duration) return `关卡「${level.id}」的基础时长必须与第 1 天一致`;
      if (legacy) {
        if (JSON.stringify(level.routes) !== JSON.stringify(firstDay.routes)) return `关卡「${level.id}」的基础路线必须与第 1 天一致`;
        const firstCells = new Set(firstDay.routes.flatMap(route => [...route.homes, ...route.goals].map(building => building.cell)));
        const futureCells = new Set(level.campaign.days.slice(1).flatMap(day => day.routes).flatMap(route => [...route.homes, ...route.goals].map(building => building.cell)).filter(cell => !firstCells.has(cell)));
        for (const road of level.initialRoads || []) if (futureCells.has(road.cell)) return `关卡「${level.id}」的初始道路占用了未来建筑工地`;
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
        const potentialError=validateLevelsFirst({version:1,chapters:[{id:'campaign-potential',name:'多日任务校验',english:'CAMPAIGN CHECK',levels:[potentialLevel]}]});
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
        for (const road of level.initialRoads || []) if (pendingCells.has(road.cell)) return `关卡「${level.id}」的初始道路占用了未解锁建筑工地`;
        for (const edge of level.initialEdges || []) if (pendingCells.has(edge[0]) || pendingCells.has(edge[1])) return `关卡「${level.id}」的初始道路占用了未解锁建筑工地`;
      }
    }
  }
  return '';
}

function errorDetails(message, details = {}) {
  const levelMatch = message.match(/关卡「([^」]+)」/), chapterMatch = message.match(/章节「([^」]+)」/);
  const pathMatch = message.match(/\b(features\.[a-z]+|initialRoads(?:\.[a-z]+)?|initialEdges|busLineLimit|homes(?:\.[a-z]+)?|goals(?:\.[a-z]+)?|campaign|levels)\b/);
  return {
    message,
    chapterId: details.chapterId ?? chapterMatch?.[1] ?? null,
    levelId: details.levelId ?? levelMatch?.[1] ?? null,
    path: details.path ?? pathMatch?.[1] ?? null,
    cell: details.cell ?? null
  };
}

function validateLevelCatalog(data) {
  const catalog = normalizeCatalog(data), errors = [], seen = new Set();
  const add = (message, details = {}) => {
    const issue = errorDetails(message, details), key = `${issue.chapterId}|${issue.levelId}|${issue.path}|${issue.cell}|${issue.message}`;
    if (!seen.has(key)) { seen.add(key);errors.push(issue); }
  };
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.chapters) || !catalog.chapters.length) {
    add('章节数据必须包含非空 chapters 数组', { path: 'chapters' });
    return { ok: false, errors };
  }
  const chapterIds = new Set(), levelIds = new Set();
  catalog.chapters.forEach((chapter, ci) => {
    const chapterPath=`chapters[${ci}]`;
    if (!chapter || typeof chapter !== 'object') { add('每个章节都必须是对象', { path: chapterPath });return; }
    const chapterId=typeof chapter.id==='string'?chapter.id:null;
    if (!chapterId || !/^[a-z0-9-]+$/.test(chapterId)) add('章节 id 只能包含小写字母、数字和连字符', { chapterId, path: `${chapterPath}.id` });
    else if (chapterIds.has(chapterId)) add(`章节 id 重复：${chapterId}`, { chapterId, path: `${chapterPath}.id` });
    else chapterIds.add(chapterId);
    if (typeof chapter.name !== 'string' || !chapter.name.trim()) add(`章节「${chapterId || ci + 1}」缺少名称`, { chapterId, path: `${chapterPath}.name` });
    if (typeof chapter.english !== 'string' || !chapter.english.trim()) add(`章节「${chapterId || ci + 1}」缺少英文名`, { chapterId, path: `${chapterPath}.english` });
    if (chapter.hidden !== undefined && typeof chapter.hidden !== 'boolean') add(`章节「${chapterId || ci + 1}」的 hidden 必须是布尔值`, { chapterId, path: `${chapterPath}.hidden` });
    if (!Array.isArray(chapter.levels)) { add(`章节「${chapterId || ci + 1}」的 levels 必须是数组`, { chapterId, path: `${chapterPath}.levels` });return; }
    chapter.levels.forEach((level, li) => {
      const base=`${chapterPath}.levels[${li}]`;
      if (!level || typeof level !== 'object') { add('每个关卡都必须是对象', { chapterId, path: base });return; }
      const levelId=typeof level.id==='string'?level.id:null, details={chapterId,levelId};
      if (!levelId || !/^[a-z0-9-]+$/.test(levelId)) add('关卡 id 只能包含小写字母、数字和连字符', {...details,path:`${base}.id`});
      else if (levelIds.has(levelId)) add(`关卡 id 重复：${levelId}`, {...details,path:`${base}.id`});
      else levelIds.add(levelId);
      for (const field of ['name','english','difficulty','title','description','tip','lesson']) if (typeof level[field] !== 'string' || !level[field].trim()) add(`关卡「${levelId || li + 1}」缺少 ${field}`, {...details,path:`${base}.${field}`});
      const width=level.width??WIDTH,height=level.height??HEIGHT, dimensionsValid=Number.isInteger(width)&&Number.isInteger(height)&&width>=MIN_MAP_SIZE&&width<=MAX_MAP_SIZE&&height>=MIN_MAP_SIZE&&height<=MAX_MAP_SIZE;
      if (!dimensionsValid) add(`关卡「${levelId || li + 1}」的地图宽高必须是 ${MIN_MAP_SIZE} 至 ${MAX_MAP_SIZE} 的整数`, {...details,path:`${base}.width`});
      if (!Number.isInteger(level.budget)||level.budget<1) add(`关卡「${levelId || li + 1}」的预算无效`, {...details,path:`${base}.budget`});
      if (!Number.isFinite(level.duration)||level.duration<1) add(`关卡「${levelId || li + 1}」的时长无效`, {...details,path:`${base}.duration`});
      if(level.starTargets!==undefined){const message=starTargetError(level.starTargets);if(message)add(`关卡「${levelId || li + 1}」的 ${message}`,{...details,path:`${base}.starTargets`});}
      if(Array.isArray(level.campaign?.days))level.campaign.days.forEach((day,di)=>{if(day?.starTargets!==undefined){const message=starTargetError(day.starTargets);if(message)add(`关卡「${levelId || li + 1}」第 ${di+1} 天的 ${message}`,{...details,path:`${base}.campaign.days[${di}].starTargets`});}});
      const features=level.features;
      if (!features || typeof features!=='object') add(`关卡「${levelId || li + 1}」的 features 必须是对象`, {...details,path:`${base}.features`});
      else {
        for (const name of ['grade','load','cut','inspect','signals']) if(typeof features[name]!=='boolean') add(`关卡「${levelId || li + 1}」的 features.${name} 必须是布尔值`, {...details,path:`${base}.features.${name}`});
        if(features.bus!==undefined&&typeof features.bus!=='boolean')add(`关卡「${levelId || li + 1}」的 features.bus 必须是布尔值`, {...details,path:`${base}.features.bus`});
      }
      if (level.busLineLimit!==undefined&&(!Number.isInteger(level.busLineLimit)||level.busLineLimit<1||level.busLineLimit>6)) add(`关卡「${levelId || li + 1}」的 busLineLimit 必须是 1 至 6 的整数`, {...details,path:`${base}.busLineLimit`});
      if (dimensionsValid) for (const field of ['water','bridges','trees']) {
        if (!Array.isArray(level[field])) { add(`关卡「${levelId || li + 1}」的 ${field} 必须是数组`, {...details,path:`${base}.${field}`});continue; }
        const cells=new Set();level[field].forEach((cell,index)=>{
          if(!isCoord(cell,width,height))add(`关卡「${levelId || li + 1}」的 ${field} 包含越界坐标 ${cell}`, {...details,path:`${base}.${field}[${index}]`,cell});
          else if(cells.has(cell))add(`关卡「${levelId || li + 1}」的 ${field} 包含重复坐标 ${cell}`, {...details,path:`${base}.${field}[${index}]`,cell});
          cells.add(cell);
        });
      }
      if (!Array.isArray(level.routes)||!level.routes.length) add(`关卡「${levelId || li + 1}」至少需要一条路线`,{...details,path:`${base}.routes`});
      else if(dimensionsValid)level.routes.forEach((route,ri)=>{
        const routePath=`${base}.routes[${ri}]`;
        if(!route||typeof route!=='object'){add(`关卡「${levelId || li + 1}」的路线必须是对象`,{...details,path:routePath});return;}
        if(typeof route.name!=='string'||!route.name.trim())add(`关卡「${levelId || li + 1}」的路线缺少 name`,{...details,path:`${routePath}.name`});
        if(typeof route.color!=='string')add(`关卡「${levelId || li + 1}」的路线缺少 color/light`,{...details,path:`${routePath}.color`});
        if(typeof route.light!=='string')add(`关卡「${levelId || li + 1}」的路线缺少 color/light`,{...details,path:`${routePath}.light`});
        for(const [kind,label] of [['homes','住宅'],['goals','目的地']]){
          if(!Array.isArray(route[kind])||!route[kind].length){add(`关卡「${levelId || li + 1}」的路线至少需要一个${label} (${kind})`,{...details,path:`${routePath}.${kind}`});continue;}
          route[kind].forEach((building,bi)=>{
            const buildingPath=`${routePath}.${kind}[${bi}]`;
            if(!building||!isCoord(building.cell,width,height)){add(`关卡「${levelId || li + 1}」的路线 ${kind} 坐标越界`,{...details,path:`${buildingPath}.cell`,cell:building?.cell});return;}
            if(kind==='homes'){
              const generationRate=building.generationRate??building.rate;
              if(!Number.isFinite(generationRate)||generationRate<=0)add(`关卡「${levelId || li + 1}」的路线 homes.generationRate 无效`,{...details,path:`${buildingPath}.generationRate`,cell:building.cell});
              if(!Number.isInteger(building.passengers)||building.passengers<=0)add(`关卡「${levelId || li + 1}」的路线 homes.passengers 无效`,{...details,path:`${buildingPath}.passengers`,cell:building.cell});
            }else{
              if(typeof building.label!=='string'||!building.label.trim())add(`关卡「${levelId || li + 1}」的路线 goals.label 无效`,{...details,path:`${buildingPath}.label`,cell:building.cell});
              if(building.input!=null&&(!Number.isInteger(building.input)||building.input<=0))add(`关卡「${levelId || li + 1}」的路线 goals.input 无效`,{...details,path:`${buildingPath}.input`,cell:building.cell});
            }
          });
        }
      });
      // Keep the full semantic validator as a backstop for roads, capacity,
      // reference designs and campaign rules. Isolating each level means one
      // deep problem cannot hide problems in later levels.
      const wrapper={version:1,chapters:[{id:'validation',name:'校验',english:'VALIDATION',levels:[level]}]};
      let deepMessage='';try{deepMessage=validateLevelsFirst(wrapper);}catch(error){deepMessage=`关卡「${levelId || li + 1}」的数据结构无法校验：${error.message}`;}
      if(deepMessage&&!errors.some(issue=>issue.chapterId===chapterId&&issue.levelId===levelId&&issue.message===deepMessage))add(deepMessage,details);
    });
  });
  if (!catalog.chapters.some(chapter=>Array.isArray(chapter?.levels)&&chapter.levels.length)) add('至少需要一个关卡',{path:'chapters'});
  return { ok: errors.length===0, errors };
}

function validateLevels(data) {
  return validateLevelCatalog(data).errors[0]?.message || '';
}

return { validateLevels, validateLevelCatalog };
});
