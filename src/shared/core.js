/* Shared, DOM-free simulation. Browser callers load level JSON before creating a City. */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const geometry = isNode ? require('./core-geometry.js') : root.TrafficGeometry;
  const installBusMethods = isNode ? require('./core-bus.js') : root.TrafficBus.installBusMethods;
  const { WIDTH, HEIGHT, MIN_MAP_SIZE, MAX_MAP_SIZE, key, point, neighbors, findPath, findWeightedPath } = geometry;
  function deepFreeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
    return value;
  }
  const catalogTools = typeof module !== 'undefined' && module.exports ? require('./level-catalog.js') : root.TrafficLevelCatalog;
  let LEVELS = [], CHAPTERS = [], api = null;
  // Replace the active chapter catalog. Legacy flat level arrays are migrated
  // in memory so existing levels.json overrides remain usable.
  function setLevels(data) {
    const catalog = catalogTools.normalizeCatalog(data);
    if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.chapters) || !catalog.chapters.length) return '章节数据必须包含非空 chapters 数组';
    const chapterIds = new Set(), levelIds = new Set(), chapters = [];
    for (const chapter of catalog.chapters) {
      if (!chapter || typeof chapter.id !== 'string' || !chapter.id || chapterIds.has(chapter.id)
        || typeof chapter.name !== 'string' || !chapter.name.trim() || typeof chapter.english !== 'string' || !chapter.english.trim()
        || !Array.isArray(chapter.levels)) return '每个章节都需要唯一 id、名称、英文名和 levels 数组';
      chapterIds.add(chapter.id);
      const levels = [];
      for (const level of chapter.levels) {
        if (!level || typeof level !== 'object' || typeof level.id !== 'string' || !level.id) return '每个关卡都需要唯一的字符串 id';
        if (levelIds.has(level.id)) return `关卡 id 重复：${level.id}`;
        const width = level.width ?? WIDTH, height = level.height ?? HEIGHT;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < MIN_MAP_SIZE || width > MAX_MAP_SIZE || height < MIN_MAP_SIZE || height > MAX_MAP_SIZE) return `关卡「${level.id}」的地图宽高必须是 ${MIN_MAP_SIZE} 至 ${MAX_MAP_SIZE} 的整数`;
        levelIds.add(level.id);levels.push(level);
      }
      chapters.push({ id: chapter.id, name: chapter.name.trim(), english: chapter.english.trim(), levels });
    }
    if (!levelIds.size) return '至少需要一个关卡';
    CHAPTERS = chapters.map(deepFreeze);LEVELS = CHAPTERS.flatMap(chapter => chapter.levels);
    if (api) { api.CHAPTERS = CHAPTERS;api.LEVELS = LEVELS; }
    return '';
  }
  const initialCatalog = typeof module !== 'undefined' && module.exports
    ? require('./level-catalog.js').loadCatalogSync(require('node:path').resolve(__dirname, '../../built-in-levels.json')) : null;
  if (initialCatalog) setLevels(initialCatalog);
  // Default scenario and convenience exports are retained for Node consumers.
  const { budget: BUDGET, duration: DURATION, routes: ROUTES } = LEVELS[0] || { budget: 0, duration: 0, routes: [] };
  const TARGET = (ROUTES || []).reduce((sum, route) => sum + routeHomes(route).reduce((routeSum, home) => routeSum + home.passengers, 0), 0);
  // A route may list one or many origins (homes) and one or many destinations
  // (goals). Each home carries its own resident generation rate and population;
  // private cars leave as soon as the connected doorway road has room. Legacy
  // definitions used `rate` for generation. The former `carRate` field is ignored.
  function normalizeHome(h) {
    const { rate, carRate, ...rest } = h, legacyRate = rate ?? 1;
    return { ...rest, generationRate: h.generationRate ?? legacyRate };
  }
  function routeHomes(r) {
    if (Array.isArray(r.homes) && r.homes.length) return r.homes.map(normalizeHome);
    return [normalizeHome({ cell: r.home, rate: r.rate, passengers: r.passengers ?? 0 })];
  }
  function routeGoals(r) {
    if (Array.isArray(r.goals) && r.goals.length) return r.goals;
    return [{ cell: r.goal, label: r.label }];
  }
  function normalizeRoute(r) {
    const { home, goal, rate, passengers, label, ...rest } = r;
    return { ...rest, homes: routeHomes(r), goals: routeGoals(r) };
  }
  const ROAD_TYPES = Object.freeze([
    Object.freeze({ name: '支路', cost: 1, speed: 2.8, lanes: 1, capacity: 2, width: .30, color: '#b3bfa7' }),
    Object.freeze({ name: '干道', cost: 2, speed: 4, lanes: 2, capacity: 4, width: .54, color: '#8da79c' }),
    Object.freeze({ name: '快速路', cost: 3, speed: 5.2, lanes: 3, capacity: 6, width: .78, color: '#708b9b' })
  ]);
  const SIGNAL_CLEARANCE = 0.25;
  const BUS_CAPACITY = 12, BUS_SPEED_MULTIPLIER = 1.35, BUS_BOARDING_RATE = 8, BUS_COST = 6;
  const BUS_LINE_COLORS = Object.freeze(['#1686a0', '#d06b47', '#7868b2', '#4f965d', '#c08a28', '#a64f78']);
  const VEHICLE_WIDTH = .085, VEHICLE_LENGTH = .28, BUS_WIDTH = .11, BUS_LENGTH = .46, LANE_WIDTH = .12;
  const ROUTE_REPLAN_INTERVAL = 1, ROUTE_SWITCH_RATIO = .82, CONGESTION_WEIGHT = 1, MAX_DYNAMIC_DELAY = 4;
  const PHASES = Object.freeze(['horizontal-straight', 'horizontal-left', 'vertical-straight', 'vertical-left']);
  const signalEntries = (width = WIDTH) => ({ north: width, east: -1, south: -width, west: 1 });
  const SIGNAL_ENTRIES = Object.freeze(signalEntries());
  const SIGNAL_ENTRY_ORDER = Object.freeze(['north', 'east', 'south', 'west']);
  const SIGNAL_ACTIONS = Object.freeze(SIGNAL_ENTRY_ORDER.flatMap(entry => ['straight', 'left'].map(turn => `${entry}-${turn}`)));
  const DEFAULT_CUSTOM_PHASES = Object.freeze([
    Object.freeze(['west-straight', 'east-straight']), Object.freeze(['west-left', 'east-left']),
    Object.freeze(['north-straight', 'south-straight']), Object.freeze(['north-left', 'south-left'])
  ]);
  const vector = (heading, width = WIDTH) => ({ x: Math.abs(heading) === 1 ? Math.sign(heading) : 0, y: Math.abs(heading) === width ? Math.sign(heading) : 0 });
  function movement(entry, exit = entry, width = WIDTH) {
    const a = vector(entry, width), b = vector(exit, width), cross = a.x * b.y - a.y * b.x;
    const turn = exit === entry ? 'straight' : cross > 0 ? 'right' : 'left';
    // Clockwise quadrants: NW, NE, SE, SW. Right-hand traffic enters
    // the first quadrant, traverses two for straight and three for left.
    const first = ({ [width]: 0, [-1]: 1, [-width]: 2, [1]: 3 })[entry];
    const count = entry === -exit ? 4 : turn === 'right' ? 1 : turn === 'straight' ? 2 : 3;
    let mask = 0;
    for (let i = 0; i < count; i++) mask |= 1 << ((first - i + 4) % 4);
    return { entry, exit, turn, mask };
  }
  function movementsConflict(a, b) {
    // Opposing protected left turns pass to the left of one another.
    if (a.turn === 'left' && b.turn === 'left' && a.entry === -b.entry && a.mask !== 15 && b.mask !== 15) return false;
    return Boolean(a.mask & b.mask);
  }
  function signalActionMovement(action, width = WIDTH) {
    const [entryName, turn] = action.split('-'), entry = signalEntries(width)[entryName];
    if (!entry || !['straight', 'left'].includes(turn)) return null;
    const leftExit = ({ [1]: -width, [width]: 1, [-1]: width, [-width]: -1 })[entry];
    return movement(entry, turn === 'straight' ? entry : leftExit, width);
  }
  function movementAction(move, width = WIDTH) {
    const entries = signalEntries(width);
    const entry = SIGNAL_ENTRY_ORDER.find(name => entries[name] === move.entry);
    return entry && move.turn !== 'right' ? `${entry}-${move.turn}` : '';
  }
  function defaultSignal() {
    return { enabled: false, green: 2, yieldMode: 'arrival', priority: [...SIGNAL_ENTRY_ORDER], automatic: true, phases: DEFAULT_CUSTOM_PHASES.map(phase => [...phase]) };
  }
  function cloneSignal(signal) { return { ...signal, priority: [...signal.priority], phases: signal.phases.map(phase => [...phase]) }; }
  function signalProblem(signal, width = WIDTH) {
    if (typeof signal.enabled !== 'boolean' || ![2,4,6].includes(signal.green)
      || !['arrival','priority'].includes(signal.yieldMode) || typeof signal.automatic !== 'boolean') return '无效的路口控制设置';
    if (!Array.isArray(signal.priority) || signal.priority.length !== SIGNAL_ENTRY_ORDER.length
      || new Set(signal.priority).size !== SIGNAL_ENTRY_ORDER.length || signal.priority.some(name => !SIGNAL_ENTRY_ORDER.includes(name))) return '路口方向优先顺序无效';
    if (!Array.isArray(signal.phases) || signal.phases.length < 1 || signal.phases.length > 8) return '手动灯序须包含 1 至 8 个阶段';
    for (const phase of signal.phases) {
      if (!Array.isArray(phase) || !phase.length || new Set(phase).size !== phase.length || phase.some(action => !SIGNAL_ACTIONS.includes(action))) return '每个手动阶段至少需要一个有效放行动作';
    }
    return '';
  }
  function vehiclePosition(n, heading, lane, slot, centered = false, width = WIDTH) {
    const p = point(n, width), d = vector(heading, width), along = centered ? 0 : slot === 0 ? -.25 : .25;
    const side = (lane + .5) * LANE_WIDTH;
    return { x: p.x + .5 + d.x * along - d.y * side, y: p.y + .5 + d.y * along + d.x * side };
  }
  class City {
    constructor(levelId = LEVELS[0].id, options = {}) {
      this.level = LEVELS.find(level => level.id === levelId);
      if (!this.level) throw new RangeError(`Unknown level: ${levelId}`);
      this.width = this.level.width ?? WIDTH;
      this.height = this.level.height ?? HEIGHT;
      this.routes = (options.routes || this.level.routes).map(normalizeRoute);
      this.runtimeBudget = options.budget;
      this.runtimeDuration = options.duration;
      this.deadlineMode = Boolean(options.deadlineMode);
      this.sandbox = Boolean(options.sandbox);
      this.pendingBuildings = new Map((options.pendingBuildings || []).map(site => [site.cell, { ...site, condition: site.condition ? { ...site.condition } : undefined }]));
      this.water = new Set(this.level.water);
      this.bridges = new Set(this.level.bridges);
      this.roads = new Set();
      this.edges = new Map();
      this.roadGrades = new Map();
      this.roadPolicies = new Map();
      this.signals = new Map();
      this.trees = new Set(this.level.trees);
      this.cars = [];
      this.buses = [];
      this.busLines = [];
      this.activeBusLineId = null;
      this.nextBusLineId = 1;
      this.elapsed = 0;
      this.delivered = 0;
      this.commuteTimes = [];
      this.arrivals = [];
      this.junctionStats = new Map();
      this.maxHomeQueues = this.routes.flatMap(route=>route.homes).map(()=>0);
      this.roadStats = new Map();
      this.rerouteCount = 0;
      this.state = 'planning';
      this.nextId = 1;
      this.rebuildRoutes();
      if (Array.isArray(this.level.initialRoads)) {
        for (const road of this.level.initialRoads) {
          const error = this.edit(road.cell,false,road.grade);
          if (error) throw new Error(`Invalid initial road: ${error}`);
        }
        for (const [a,b] of this.level.initialEdges || []) {
          const error = this.connect(a,b,null);
          if (error) throw new Error(`Invalid initial edge: ${error}`);
        }
      } else for (const [a,b,grade = 0] of this.level.initialEdges || []) {
        const error = this.connect(a,b,grade);
        if (error) throw new Error(`Invalid initial road: ${error}`);
      }
    }
    get budget() { return this.runtimeBudget ?? this.level.budget; }
    get duration() { return this.sandbox ? Infinity : this.runtimeDuration ?? this.level.duration; }
    get target() { return this.homes.reduce((sum, home) => sum + home.passengers, 0); }
    key(x, y) { return key(x, y, this.width); }
    point(n) { return point(n, this.width); }
    neighbors(n) { return neighbors(n, this.width, this.height); }
    movement(entry, exit = entry) { return movement(entry, exit, this.width); }
    canEditDesign() { return this.state === 'planning' || this.sandbox && ['running','paused'].includes(this.state); }
    movementAction(move) { return movementAction(move, this.width); }
    vector(heading) { return vector(heading, this.width); }
    links(n) { return [...(this.edges.get(n) || [])]; }
    addEdge(a,b) {
      if (!this.edges.has(a)) this.edges.set(a,new Set());
      if (!this.edges.has(b)) this.edges.set(b,new Set());
      this.edges.get(a).add(b);this.edges.get(b).add(a);
    }
    removeEdge(a,b) {
      this.edges.get(a)?.delete(b);this.edges.get(b)?.delete(a);
      if (!this.edges.get(a)?.size) this.edges.delete(a);
      if (!this.edges.get(b)?.size) this.edges.delete(b);
    }
    edgeLocked(a,b) {
      return this.cars.some(c => !c.done && ((c.cell===a && c.next===b) || (c.cell===b && c.next===a)
        || [[c.cell,c.cellMovement],[c.next,c.nextMovement]].some(([n,m]) => (n===a && m?.exitCell===b) || (n===b && m?.exitCell===a))));
    }
    connect(a,b,grade=0) {
      if (!this.canEditDesign()) return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!Number.isInteger(a) || !Number.isInteger(b) || a<0 || b<0 || a>=this.width*this.height || b>=this.width*this.height || !this.neighbors(a).includes(b)) return '请沿相邻方格拖动';
      if (this.buildings.has(a) && this.buildings.has(b)) return '建筑之间需要道路';
      if (!this.edges.get(a)?.has(b) && [a,b].some(n=>this.roads.has(n) && this.links(n).length===2 && this.occupants(n).length)) return '请等车辆通过后再增设路口';
      const roads=new Set(this.roads), grades=new Map(this.roadGrades);
      for (const n of [a,b]) if (!this.buildings.has(n)) {
        const targetGrade=grade===null?(this.roads.has(n)?this.roadGrades.get(n)||0:0):grade;
        const error=this.edit(n,false,targetGrade);
        if (error) {this.roads=roads;this.roadGrades=grades;this.refreshPaths();return error;}
      }
      this.addEdge(a,b);this.refreshPaths();return '';
    }
    busUsesEdge(a,b) {
      return this.busLines.some(line => line.route.slice(1).some((n,i) => n === b && line.route[i] === a || n === a && line.route[i] === b));
    }
    cut(a,b) {
      if (!this.canEditDesign()) return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!this.edges.get(a)?.has(b)) return '';
      if (this.busUsesEdge(a,b)) return '这段道路正在公交线路上，请先清除或重画线路';
      if (this.edgeLocked(a,b)) return '车辆正在通过或已预约这段连接，请稍后剪断';
      if ([a,b].some(n=>this.signals.has(n) && this.links(n).length===3 && this.occupants(n).length)) return '请等车辆通过后再改变路口';
      this.removeEdge(a,b);this.refreshPaths();return '';
    }
    roadType(n) { return ROAD_TYPES[this.roadGrades.get(n) || 0]; }
    turnLane(n, turn) {
      const lanes = this.roadType(n).lanes;
      if (lanes === 1) return 0;
      if (lanes === 2) return turn === 'left' ? 0 : 1;
      return turn === 'left' ? 0 : turn === 'straight' ? 1 : 2;
    }
    get remaining() {
      let spent = 0;
      for (const n of this.roads) spent += this.roadType(n).cost;
      for (const line of this.busLines) if (line.route.length) spent += line.count * BUS_COST;
      return this.budget - spent;
    }
    rebuildRoutes() {
      const homes = [], goals = [];
      this.routes.forEach((r, ri) => {
        for (const h of routeHomes(r)) homes.push({ route: ri, cell: h.cell, generationRate: h.generationRate, passengers: h.passengers ?? 0, color: r.color, light: r.light });
        for (const g of routeGoals(r)) goals.push({ route: ri, cell: g.cell, label: g.label, input: g.input, color: r.color, light: r.light });
      });
      this.homes = homes;
      this.goals = goals;
      this.buildings = new Set([...homes.map(h => h.cell), ...goals.map(g => g.cell)]);
      this.queues = homes.map(() => 0);
      this.queueTimes = homes.map(() => []);
      this.generated = homes.map(() => 0);
      this.spawnTimers = homes.map(h => 1 / h.generationRate);
      this.byRoute = this.routes.map(() => 0);
      this.byGoal = goals.map(() => 0);
      this.goalAssigned = goals.map(() => 0);
      this.departedByHome = homes.map(() => 0);
      this.refreshPaths();
    }
    setRoutes(routes) {
      this.routes = routes.map(normalizeRoute);
      this.rebuildRoutes();
    }
    defaultGoalCell(ri) {
      const g = this.goals.find(g => g.route === ri);
      return g ? g.cell : null;
    }
    routeConnected(ri) {
      return this.homes.every((h, hi) => h.route !== ri || this.paths[hi] != null);
    }
    pathCost(path, options = {}) {
      if (!path) return Infinity;
      let total = 0;
      for (let i = 1; i < path.length; i++) total += options.dynamic ? this.dynamicRoadTravelCost(path[i - 1],path[i],options.self) : this.roadTravelCost(path[i - 1],path[i]);
      return total;
    }
    roadTravelCost(a, b) {
      if ([a,b].some(cell => this.roadPolicies.get(cell) === 'avoid')) return Infinity;
      const speeds = [a,b].filter(cell => this.roads.has(cell)).map(cell => this.roadType(cell).speed);
      const preferred = [a,b].some(cell => this.roadPolicies.get(cell) === 'prefer');
      return (preferred ? .82 : 1) / (speeds.length ? Math.min(...speeds) : ROAD_TYPES[0].speed);
    }
    dynamicRoadTravelCost(a,b,self=null) {
      const base=this.roadTravelCost(a,b);
      if(!Number.isFinite(base)||!this.roads.has(b))return base;
      const load=this.load(b,self),vehicles=this.occupants(b,self),ratio=Math.min(2,load.ratio);
      let delay=base*CONGESTION_WEIGHT*ratio*ratio;
      if(vehicles.length)delay+=Math.min(2,vehicles.reduce((sum,vehicle)=>sum+Math.min(vehicle.blocked||0,2),0)/Math.max(1,load.capacity));
      const signal=this.signals.get(b);
      if(signal){
        const entry=SIGNAL_ENTRY_ORDER.find(name=>signalEntries(this.width)[name]===b-a),stats=entry&&this.junctionStats.get(b)?.entries[entry];
        if(stats)delay+=Math.min(MAX_DYNAMIC_DELAY,stats.passed?stats.queueSeconds/stats.passed:stats.maxQueue*.25);
        if(signal.enabled){const phases=signal.automatic?this.automaticSignalPhases(b):signal.phases;delay+=Math.min(MAX_DYNAMIC_DELAY,Math.max(0,(phases.length-1)*signal.green+phases.length*SIGNAL_CLEARANCE)/2);}
      }
      return base+delay;
    }
    findCarPath(start, goal, options = {}) {
      const dynamic=Boolean(options.dynamic),self=options.self||null;
      return findWeightedPath(this.roads,start,goal,this.edges,(a,b)=>dynamic?this.dynamicRoadTravelCost(a,b,self):this.roadTravelCost(a,b),this.width,this.height);
    }
    bestGoalPath(hi, options = {}) {
      const home = this.homes[hi];
      let goalIndex = null, path = null, cost = Infinity;
      for (let gi = 0; gi < this.goals.length; gi++) {
        const g = this.goals[gi];
        if (g.route !== home.route) continue;
        if (g.input != null && this.goalAssigned[gi] >= g.input) continue;
        const candidate = this.findCarPath(home.cell,g.cell,options),candidateCost=this.pathCost(candidate,options);
        if (candidate && (candidateCost + 1e-9 < cost || Math.abs(candidateCost-cost)<1e-9 && (!path || candidate.length<path.length))) { path = candidate; cost = candidateCost; goalIndex = gi; }
      }
      return { goalIndex, path, cost };
    }
    planCarPath(car, force = false) {
      if(!car||car.done)return null;
      const goal=car.goal??this.defaultGoalCell(car.route),index=Array.isArray(car.plannedPath)?car.plannedPath.indexOf(car.cell):-1;
      let current=index>=0?car.plannedPath.slice(index):null;
      if(current&&!current.slice(1).every((cell,i)=>this.edges.get(current[i])?.has(cell)))current=null;
      if(!force&&current&&this.elapsed<(car.replanAt??0))return current;
      const currentCost=this.pathCost(current,{dynamic:true,self:car}),candidate=this.findCarPath(car.cell,goal,{dynamic:true,self:car});
      if(!candidate){car.replanAt=this.elapsed+ROUTE_REPLAN_INTERVAL;return Number.isFinite(currentCost)?current:null;}
      const candidateCost=this.pathCost(candidate,{dynamic:true,self:car});
      const changed=current&&candidate.some((cell,i)=>cell!==current[i])&&(candidateCost<=currentCost*ROUTE_SWITCH_RATIO||!Number.isFinite(currentCost));
      if(!current||changed){car.plannedPath=candidate;if(changed){car.routeChanges=(car.routeChanges||0)+1;this.rerouteCount++;}current=candidate;}
      else car.plannedPath=current;
      car.replanAt=this.elapsed+ROUTE_REPLAN_INTERVAL;
      return current;
    }
    setRoadPolicy(cells, policy = null) {
      if (!this.canEditDesign()) return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!Array.isArray(cells) || !['prefer','avoid',null].includes(policy) || cells.some(cell => !Number.isInteger(cell) || !this.roads.has(cell))) return '道路偏好设置无效';
      for (const cell of cells) if (policy === null) this.roadPolicies.delete(cell); else this.roadPolicies.set(cell, policy);
      for(const car of this.cars)car.replanAt=0;
      this.refreshPaths();return '';
    }
    refreshPaths() {
      const paths = [], homeGoal = [];
      for (let hi = 0; hi < this.homes.length; hi++) {
        const result = this.bestGoalPath(hi);
        paths[hi] = result.path; homeGoal[hi] = result.goalIndex;
      }
      this.paths = paths;
      this.homeGoal = homeGoal;
      const junctions = new Set([...this.roads].filter(n => this.links(n).length >= 3));
      for (const n of this.signals.keys()) if (!junctions.has(n)) this.signals.delete(n);
      for (const n of junctions) if (!this.signals.has(n)) this.signals.set(n, defaultSignal());
    }
    passengerBreakdown(homeIndex = null) {
      const indices = homeIndex === null ? this.homes.map((_, index) => index) : Number.isInteger(homeIndex) && this.homes[homeIndex] ? [homeIndex] : [];
      const selected = new Set(indices), total = indices.reduce((sum, index) => sum + this.homes[index].passengers, 0);
      const generated = indices.reduce((sum, index) => sum + this.generated[index], 0);
      const waiting = indices.reduce((sum, index) => sum + this.queues[index], 0);
      const carTransit = this.cars.filter(car => !car.done && selected.has(car.homeIndex)).length;
      const busTransit = this.buses.reduce((sum, bus) => sum + bus.passengers.filter(passenger => selected.has(passenger.homeIndex)).length, 0)+this.transferPassengers().filter(passenger=>selected.has(passenger.homeIndex)).length;
      const arrived = indices.reduce((sum, index) => sum + this.departedByHome[index], 0) - carTransit - busTransit;
      return { total, ungenerated: total - generated, waiting, carTransit, busTransit, arrived };
    }
    goalBreakdown(goalIndex) {
      const goal = this.goals[goalIndex];
      if (!goal) return null;
      const arrived = this.byGoal[goalIndex], reserved = Math.max(0, this.goalAssigned[goalIndex] - arrived);
      return { capacity: goal.input, remaining: goal.input == null ? null : Math.max(0, goal.input - this.goalAssigned[goalIndex]), reserved, arrived };
    }
    homeTravelInfo(homeIndex) {
      const home = this.homes[homeIndex];
      if (!home) return null;
      const matchingGoals = this.goals.map((goal, index) => goal.route === home.route ? index : -1).filter(index => index >= 0);
      const availableGoals = matchingGoals.filter(index => this.goals[index].input == null || this.goalAssigned[index] < this.goals[index].input);
      const dynamic=['running','paused'].includes(this.state),{ goalIndex: carGoalIndex, path } = this.bestGoalPath(homeIndex,dynamic?{dynamic:true}:{});
      const busItinerary=this.busItineraryFor(homeIndex),busGoalIndex=busItinerary?.goalIndex??null,busLine=this.busLine(busItinerary?.legs[0]?.lineId);
      const assignedGoalIndices = [...new Set([
        ...this.cars.filter(car => !car.done && car.homeIndex === homeIndex).map(car => car.goalIndex),
        ...this.buses.flatMap(bus => bus.passengers.filter(passenger => passenger.homeIndex === homeIndex).map(passenger => passenger.goalIndex))
      ].filter(index => Number.isInteger(index)))];
      let reason = '';
      if (!matchingGoals.length) reason = '没有配置同色目的地';
      else if (!availableGoals.length) reason = '同色目的地容量均已分配完毕';
      else if (!path && busGoalIndex === null) reason = !this.links(home.cell).length ? '住宅没有明确连接道路出口' : this.busLines.length ? '道路未连通，公交线路或站序也不服务这栋住宅' : '道路未连接到可用的同色目的地';
      else if (path && this.queues[homeIndex] > 0) {
        const heading = path[1] - path[0];
        if (!this.available(home.cell, heading) || !this.available(path[1], heading)) reason = '住宅出口或门口道路已满，居民正在等待';
      }
      const roadCells = path ? path.filter(cell => this.roads.has(cell)) : [];
      const minimumSpeed = roadCells.length ? Math.min(...roadCells.map(cell => this.roadType(cell).speed)) : 0;
      const bottlenecks = roadCells.filter(cell => this.roadType(cell).speed === minimumSpeed);
      let freeFlowTime = 0;
      if (path) for (let i = 1; i < path.length; i++) {
        const speeds = [path[i - 1], path[i]].filter(cell => this.roads.has(cell)).map(cell => this.roadType(cell).speed);
        freeFlowTime += 1 / (speeds.length ? Math.min(...speeds) : ROAD_TYPES[0].speed);
      }
      return { homeIndex, carGoalIndex, busGoalIndex, busLineId: busLine?.id || null, busItinerary, assignedGoalIndices, path, distance: path ? path.length - 1 : null, freeFlowTime, bottlenecks, dynamic, reason };
    }
    signalConflicts(actions) {
      if(!Array.isArray(actions))return [];
      const conflicts=[];
      for(let i=0;i<actions.length;i++)for(let j=i+1;j<actions.length;j++){
        const a=signalActionMovement(actions[i],this.width),b=signalActionMovement(actions[j],this.width);
        if(a&&b&&movementsConflict(a,b))conflicts.push([actions[i],actions[j]]);
      }
      return conflicts;
    }
    suggestSignalPhases(n) {
      if(!this.signals.has(n))return [];
      const scores=new Map(SIGNAL_ACTIONS.map(action=>[action,0]));
      for(const homeIndex of this.homes.keys()){
        const path=this.bestGoalPath(homeIndex).path;if(!path)continue;
        for(let i=1;i<path.length-1;i++)if(path[i]===n){const action=this.movementAction(this.movement(path[i]-path[i-1],path[i+1]-path[i]));if(action)scores.set(action,scores.get(action)+this.homes[homeIndex].passengers);}
      }
      const actions=SIGNAL_ACTIONS.filter(action=>scores.get(action)>0).sort((a,b)=>scores.get(b)-scores.get(a)||SIGNAL_ACTIONS.indexOf(a)-SIGNAL_ACTIONS.indexOf(b));
      if(!actions.length)return this.automaticSignalPhases(n).map(phase=>phase.actions);
      const phases=[];
      for(const action of actions){let phase=phases.find(items=>!this.signalConflicts([...items,action]).length);if(!phase){phase=[];phases.push(phase);}phase.push(action);}
      return phases;
    }
    junctionReports() {
      return [...this.junctionStats].map(([cell,stats])=>({cell,entries:Object.fromEntries(Object.entries(stats.entries).map(([entry,data])=>[entry,{averageWait:data.passed?data.queueSeconds/data.passed:0,maxQueue:data.maxQueue,passed:data.passed}]))}));
    }
    roadHotspots(limit=3) {
      if(!Number.isInteger(limit)||limit<1)return [];
      return [...this.roadStats].map(([cell,stats])=>({cell,...stats})).sort((a,b)=>b.blockedSeconds-a.blockedSeconds||b.occupancySeconds-a.occupancySeconds||a.cell-b.cell).slice(0,limit);
    }
    setSignal(n, enabled, green = 2) {
      if (!this.canEditDesign()) return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!this.signals.has(n)) return '请选择三岔或十字路口';
      const current = this.signals.get(n), candidate = cloneSignal(current);
      if (enabled && typeof enabled === 'object') {
        for (const field of ['enabled','green','yieldMode','automatic']) if (enabled[field] !== undefined) candidate[field] = enabled[field];
        if (enabled.priority !== undefined) candidate.priority = Array.isArray(enabled.priority) ? [...enabled.priority] : enabled.priority;
        if (enabled.phases !== undefined) candidate.phases = Array.isArray(enabled.phases) ? enabled.phases.map(phase => Array.isArray(phase) ? [...phase] : phase) : enabled.phases;
      } else { candidate.enabled = enabled; candidate.green = green; }
      const problem = signalProblem(candidate, this.width);
      if (problem) return problem;
      if (current.enabled !== candidate.enabled && this.occupants(n).length) return '请等路口车辆通过后再切换控制方式';
      this.signals.set(n, candidate);
      return '';
    }
    automaticSignalPhases(n) {
      const entries = this.links(n).map(v => n - v);
      if (entries.length === 3) {
        const main = entries.filter(entry => entries.includes(-entry));
        const branch = entries.find(entry => !main.includes(entry));
        if (main.length === 2 && branch !== undefined) {
          const mainLeft = main.map(entry => this.movement(entry, -branch)).filter(move => move.turn === 'left').map(move => this.movementAction(move));
          const branchLeft = main.map(entry => this.movement(branch, -entry)).filter(move => move.turn === 'left').map(move => this.movementAction(move));
          return [
            { stage: 'main-straight', axis: Math.abs(main[0]) === 1 ? 'horizontal' : 'vertical', turn: 'straight', actions: main.map(entry => this.movementAction(this.movement(entry))) },
            { stage: 'main-turn', axis: 'main', turn: 'left', actions: mainLeft },
            { stage: 'branch-turn', axis: 'branch', turn: 'left', actions: branchLeft }
          ];
        }
      }
      return PHASES.map((stage, index) => {
        const [axis, turn] = stage.split('-');
        return { stage, axis, turn, actions: [...DEFAULT_CUSTOM_PHASES[index]] };
      });
    }
    signalPhase(n) {
      const signal = this.signals.get(n);
      if (!signal || !signal.enabled) return { axis: 'off', turn: 'off', stage: 'off', remaining: 0, actions: [] };
      const phases = signal.automatic ? this.automaticSignalPhases(n) : signal.phases;
      const span = signal.green + SIGNAL_CLEARANCE;
      const t = this.elapsed % (span * phases.length), local = t % span, index = Math.floor(t / span);
      if (local >= signal.green) return { axis: 'clearance', turn: 'clearance', stage: 'clearance', remaining: span - local, actions: [], index };
      if (!signal.automatic) return { axis: 'custom', turn: 'custom', stage: 'custom', remaining: signal.green - local, actions: phases[index], index };
      return { ...phases[index], remaining: signal.green - local, index };
    }
    canEnter(n, heading, exitHeading = heading) {
      const signal = this.signals.get(n), phase = this.signalPhase(n), move = this.movement(heading, exitHeading);
      if (move.turn === 'right' || phase.axis === 'off') return true;
      if (!signal || phase.axis === 'clearance') return false;
      return phase.actions.includes(this.movementAction(move));
    }
    occupants(n, self) { return [...this.cars,...this.buses].filter(c => !c.done && c.active !== false && c !== self && (c.cell === n || c.next === n)); }
    reservations(car) {
      const slots = [{ cell: car.cell, heading: car.cellHeading ?? car.heading, lane: car.cellLane || 0, slot: car.cellSlot ?? 1, movement: car.cellMovement }];
      if (car.next !== null) slots.push({ cell: car.next, heading: car.heading, lane: car.lane || 0, slot: car.nextSlot ?? 0, movement: car.nextMovement });
      return slots;
    }
    junctionAvailable(n, move, self) {
      if (!this.signals.get(n)?.enabled) return this.occupants(n,self).length===0;
      return !this.occupants(n, self).some(c => this.reservations(c).some(r => r.cell === n && movementsConflict(move, r.movement || { mask: 15 })));
    }
    laneFor(n, heading, self, slot = 0, exitHeading = heading, preferred = 0, strict = false) {
      if (this.signals.has(n)) return this.junctionAvailable(n, this.movement(heading, exitHeading), self) ? 0 : -1;
      const cars = this.occupants(n, self);
      if (!this.roads.has(n)) return cars.length ? -1 : 0;
      const lanes = this.roadType(n).lanes, choices = strict ? [preferred] : Array.from({ length: lanes }, (_, i) => (preferred + i) % lanes);
      for (const lane of choices) {
        if (!cars.some(c => this.reservations(c).some(r => r.cell === n && r.heading === heading && r.lane === lane && r.slot === slot))) return lane;
      }
      return -1;
    }
    load(n, self = null) {
      const cars = this.occupants(n,self);
      if (this.signals.has(n)) {
        if (!this.signals.get(n).enabled) return { used: cars.length, capacity: 1, total: cars.length, ratio: cars.length };
        let mask = 0;
        for (const car of cars) for (const r of this.reservations(car)) if (r.cell === n) mask |= r.movement?.mask ?? 15;
        const used = [1,2,4,8].filter(bit => mask & bit).length;
        return { used, capacity: 4, total: cars.length, ratio: used / 4 };
      }
      const used = Math.max(0, ...[1,-1,this.width,-this.width].map(h => cars.filter(c => this.reservations(c).some(r => r.cell === n && r.heading === h)).length));
      const capacity = this.roadType(n).capacity;
      return { used, capacity, total: cars.length, ratio: used / capacity };
    }
    exitLocked(n) {
      return this.cars.some(c => !c.done && [c.cellMovement, c.nextMovement].some(m => m?.exitCell === n));
    }
    anchor(n, heading, lane, slot, move) {
      const position = vehiclePosition(n, heading, lane, slot, this.signals.has(n) || this.buildings.has(n), this.width);
      let direction = this.vector(heading);
      if (this.signals.has(n) && move && move.turn !== 'straight' && move.entry !== -move.exit) {
        const a = this.vector(move.entry), b = this.vector(move.exit), p = this.point(n);
        const inset = move.turn === 'right' ? .25 : .07;
        position.x = p.x + .5 + (b.x-a.x)*inset;
        position.y = p.y + .5 + (b.y-a.y)*inset;
        direction = { x: (a.x+b.x)/Math.SQRT2, y: (a.y+b.y)/Math.SQRT2 };
      }
      return { ...position, direction };
    }
    pose(car) {
      const start = this.anchor(car.cell, car.cellHeading ?? car.heading, car.cellLane || 0, car.cellSlot ?? 1, car.cellMovement);
      const d = start.direction;
      if (car.next === null) return { x: start.x, y: start.y, angle: Math.atan2(d.y, d.x) };
      const end = this.anchor(car.next, car.heading, car.lane || 0, car.nextSlot ?? 0, car.nextMovement);
      const t = Math.min(car.progress, 1), b = end.direction;
      // Smooth turns and lane changes without changing the vehicle dimensions.
      const length = Math.hypot(end.x-start.x, end.y-start.y) * .5;
      const c1 = { x: start.x+d.x*length, y: start.y+d.y*length };
      const c2 = { x: end.x-b.x*length, y: end.y-b.y*length }, u = 1-t;
      const x = u*u*u*start.x+3*u*u*t*c1.x+3*u*t*t*c2.x+t*t*t*end.x;
      const y = u*u*u*start.y+3*u*u*t*c1.y+3*u*t*t*c2.y+t*t*t*end.y;
      const dx = u*u*(c1.x-start.x)+2*u*t*(c2.x-c1.x)+t*t*(end.x-c2.x);
      const dy = u*u*(c1.y-start.y)+2*u*t*(c2.y-c1.y)+t*t*(end.y-c2.y);
      return { x, y, angle: Math.atan2(dy, dx) };
    }
    transact(actions) {
      if (!Array.isArray(actions)) return '规划操作无效';
      const snapshot = {
        roads: new Set(this.roads),
        edges: new Map([...this.edges].map(([n, links]) => [n, new Set(links)])),
        grades: new Map(this.roadGrades),
        policies: new Map(this.roadPolicies),
        signals: new Map([...this.signals].map(([n, signal]) => [n, cloneSignal(signal)]))
      };
      for (const action of actions) {
        let message = '规划操作无效';
        if (action?.type === 'connect') message = this.connect(action.a, action.b, action.grade);
        else if (action?.type === 'cut') message = this.cut(action.a, action.b);
        else if (action?.type === 'edit') message = this.edit(action.cell, action.erase, action.grade);
        if (!message) continue;
        this.roads = snapshot.roads;
        this.edges = snapshot.edges;
        this.roadGrades = snapshot.grades;
        this.roadPolicies = snapshot.policies;
        this.signals = snapshot.signals;
        this.refreshPaths();
        return message;
      }
      return '';
    }
    edit(n, erase = false, grade = 0) {
      if (!Number.isInteger(n) || n < 0 || n >= this.width * this.height) return '';
      if (!this.canEditDesign()) return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!Number.isInteger(grade) || !ROAD_TYPES[grade]) return '无效的道路等级';
      if (this.buildings.has(n)) return '把道路修到建筑旁边，即可连接';
      if (this.pendingBuildings.has(n)) return '这里是建设用地，请为即将落成的建筑预留空间';
      if (erase) {
        if (!this.roads.has(n)) return '';
        if (this.busLines.some(line => line.route.includes(n))) return '这格道路正在公交线路上，请先删除或重画线路';
        if (this.occupants(n).length || this.exitLocked(n)) return '这里有车辆或路口出口预约，请等车辆通过后再拆除';
        if (this.links(n).some(v => this.signals.has(v) && this.links(v).length === 3 && this.occupants(v).length)) return '相邻路口有车辆，请等车辆通过后再改变路口';
        for (const v of this.links(n)) this.removeEdge(n,v);
        this.roads.delete(n);
        this.roadGrades.delete(n);
        this.roadPolicies.delete(n);
      } else {
        const exists = this.roads.has(n), oldGrade = this.roadGrades.get(n) || 0;
        if (exists && oldGrade === grade) return '';
        if (!exists && this.water.has(n) && !this.bridges.has(n)) return '河流上不能修路，请经过桥梁';
        if (this.trees.has(n)) return '保留这片绿地吧，试着绕行';
        if (exists && grade < oldGrade && (this.occupants(n).length || this.exitLocked(n))) return '这里有车辆，请等车辆通过后再降级';
        const difference = ROAD_TYPES[grade].cost - (exists ? ROAD_TYPES[oldGrade].cost : 0);
        if (this.remaining < difference) return '建设预算不足，降级或拆除闲置道路可以返还';
        this.roads.add(n);
        this.roadGrades.set(n, grade);
      }
      this.refreshPaths();
      return '';
    }
    resetOperation() {
      this.queues = this.homes.map(() => 0);
      this.queueTimes = this.homes.map(() => []);
      this.generated = this.homes.map(() => 0);
      this.spawnTimers = this.homes.map(h => 1 / h.generationRate);
      this.byRoute = this.routes.map(() => 0);
      this.byGoal = this.goals.map(() => 0);
      this.goalAssigned = this.goals.map(() => 0);
      this.departedByHome = this.homes.map(() => 0);
      this.cars = [];
      this.buses = [];
      this.elapsed = 0;
      this.delivered = 0;
      this.commuteTimes = [];
      this.arrivals = [];
      this.junctionStats = new Map();
      this.maxHomeQueues = this.homes.map(()=>0);
      this.roadStats = new Map();
      this.rerouteCount = 0;
      this.resetBusStats();
      this.state = 'planning';
      this.nextId = 1;
      this.refreshPaths();
    }
    stop() {
      if (this.state !== 'running' && this.state !== 'paused') return false;
      this.resetOperation();
      return true;
    }
    serializeDesign() {
      return {
        version: 8,
        width: this.width,
        height: this.height,
        edges: [...this.edges].flatMap(([a,vs])=>[...vs].filter(b=>a<b).map(b=>[a,b])).sort(([a,b],[c,d])=>a-c||b-d),
        levelId: this.level.id,
        roads: [...this.roads].sort((a, b) => a - b).map(cell => ({ cell, grade: this.roadGrades.get(cell) || 0 })),
        roadPolicies: [...this.roadPolicies].sort(([a],[b])=>a-b).map(([cell,policy])=>({cell,policy})),
        signals: [...this.signals].sort(([a], [b]) => a - b).map(([cell, signal]) => ({ cell, ...cloneSignal(signal) })),
        busLines: this.busLines.map(line => ({ id: line.id, name: line.name, color: line.color, route: [...line.route], count: line.count, stops: [...line.stops].sort((a,b)=>a-b), returnTrip: line.returnTrip, returnStops: line.returnStops, headway: line.headway })),
        activeBusLineId: this.activeBusLineId
      };
    }
    loadDesign(design) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能读取设计，请先停止运营';
      if (!design || ![1,2,3,4,5,6,7,8].includes(design.version) || design.levelId !== this.level.id || !Array.isArray(design.roads) || !Array.isArray(design.signals)
        || design.version>=7&&(design.width!==this.width||design.height!==this.height)
        || design.version<7&&(this.width!==WIDTH||this.height!==HEIGHT)) return '存档格式无效、地图尺寸不匹配或不属于当前关卡';
      const candidate = new City(this.level.id, {
        routes: this.routes, budget: this.budget, duration: this.duration,
        deadlineMode: this.deadlineMode, pendingBuildings: [...this.pendingBuildings.values()]
      }), seenRoads = new Set(), seenSignals = new Set();
      candidate.roads.clear();candidate.roadGrades.clear();candidate.edges.clear();candidate.signals.clear();
      candidate.refreshPaths();
      for (const road of design.roads) {
        if (!road || !Number.isInteger(road.cell) || road.cell < 0 || road.cell >= this.width * this.height
          || !Number.isInteger(road.grade) || !ROAD_TYPES[road.grade] || seenRoads.has(road.cell)) return '存档中的道路数据无效';
        seenRoads.add(road.cell);
        const message = candidate.edit(road.cell, false, road.grade);
        if (message) return `无法读取设计：${message}`;
      }
      if (design.version===1) {
        // Older designs intentionally connected every adjacent road/building.
        for (const n of candidate.roads) for (const v of candidate.neighbors(n)) if (candidate.roads.has(v)||candidate.buildings.has(v)) candidate.addEdge(n,v);
      } else {
        if (!Array.isArray(design.edges)) return '存档缺少道路连接';
        candidate.edges.clear();const seen=new Set();
        for (const pair of design.edges) {
          if (!Array.isArray(pair)||pair.length!==2) return '存档中的连接无效';
          const [a,b]=pair,id=`${Math.min(a,b)}:${Math.max(a,b)}`;
          if (!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=this.width*this.height||b>=this.width*this.height||!candidate.neighbors(a).includes(b)||seen.has(id)
            ||![a,b].every(n=>candidate.roads.has(n)||candidate.buildings.has(n))||[a,b].every(n=>candidate.buildings.has(n))) return '存档中的连接无效';
          candidate.addEdge(a,b);seen.add(id);
        }
      }
      if (design.version >= 8) {
        if (!Array.isArray(design.roadPolicies)) return '存档中的道路偏好无效';
        const seenPolicies = new Set();
        for (const saved of design.roadPolicies) {
          if (!saved || !Number.isInteger(saved.cell) || !candidate.roads.has(saved.cell) || seenPolicies.has(saved.cell) || !['prefer','avoid'].includes(saved.policy)) return '存档中的道路偏好无效';
          candidate.roadPolicies.set(saved.cell,saved.policy);seenPolicies.add(saved.cell);
        }
      }
      candidate.refreshPaths();
      for (const saved of design.signals) {
        if (!saved || !Number.isInteger(saved.cell) || seenSignals.has(saved.cell)
          || typeof saved.enabled !== 'boolean' || ![2, 4, 6].includes(saved.green)
          || !candidate.signals.has(saved.cell)
          || design.version >= 6 && signalProblem(saved, this.width)) return '存档中的信号灯数据无效';
        const settings = design.version >= 6
          ? { enabled: saved.enabled, green: saved.green, yieldMode: saved.yieldMode, priority: saved.priority, automatic: saved.automatic, phases: saved.phases }
          : { enabled: saved.enabled, green: saved.green };
        const message = candidate.setSignal(saved.cell, settings);
        if (message) return '存档中的信号灯数据无效';
        seenSignals.add(saved.cell);
      }
      if (design.version === 3) {
        if (design.bus !== null && (!design.bus || typeof design.bus !== 'object' || !Array.isArray(design.bus.route))) return '存档中的公交线路无效';
        if (design.bus) {
          let message = candidate.setBusCount(design.bus.count);
          if (!message) message = candidate.setBusRoute(design.bus.route);
          if (message) return `无法读取设计：${message}`;
          const disabled = design.bus.disabledStops ?? [];
          if (!Array.isArray(disabled) || disabled.some(cell => !Number.isInteger(cell) || !candidate.buildings.has(cell)) || new Set(disabled).size !== disabled.length) return '存档中的公交站点无效';
          const line = candidate.activeBusLine;
          for (const building of disabled) for (const road of candidate.neighbors(building)) line.stops.delete(road);
        }
      } else if ([4,5,6,7,8].includes(design.version)) {
        if (!Array.isArray(design.busLines) || design.busLines.length > candidate.busLineLimit) return '存档中的公交线路无效';
        const ids = new Set();
        for (const saved of design.busLines) {
          if (!saved || typeof saved.id !== 'string' || !/^[a-z0-9-]{1,30}$/i.test(saved.id) || ids.has(saved.id)
            || typeof saved.name !== 'string' || !saved.name.trim() || saved.name.trim().length > 20
            || typeof saved.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(saved.color)
            || !Array.isArray(saved.route) || !Array.isArray(saved.stops)
            || design.version >= 5 && (typeof saved.returnTrip !== 'boolean' || saved.returnTrip && saved.route.length >= 3 && saved.route[0] === saved.route[saved.route.length - 1])
            || design.version >= 8 && (typeof saved.returnStops !== 'boolean' || ![2,4,6,8].includes(saved.headway))) return '存档中的公交线路无效';
          ids.add(saved.id);
          candidate.busLines.push({ id: saved.id, name: saved.name.trim(), color: saved.color.toLowerCase(), route: [], count: 1, stops: new Set(), returnTrip: design.version >= 5 ? saved.returnTrip : false, returnStops: design.version >= 8 ? saved.returnStops : false, headway: design.version >= 8 ? saved.headway : 4, stats: null });
          candidate.activeBusLineId = saved.id;
          let message = candidate.setBusCount(saved.count, saved.id);
          if (!message) message = candidate.setBusRoute(saved.route, saved.id);
          if (message) return `无法读取设计：${message}`;
          if (saved.stops.some(cell => !Number.isInteger(cell) || !candidate.canSetBusStop(cell, saved.id)) || new Set(saved.stops).size !== saved.stops.length) return '存档中的公交站点无效';
          candidate.busLine(saved.id).stops = new Set(saved.stops);
        }
        if (design.activeBusLineId !== null && !ids.has(design.activeBusLineId)) return '存档中的当前公交线路无效';
        candidate.activeBusLineId = design.activeBusLineId;
        candidate.nextBusLineId = Math.max(0, ...candidate.busLines.map(line => Number(line.id.match(/(\d+)$/)?.[1]) || 0)) + 1;
      }
      this.edges = candidate.edges;
      this.roads = candidate.roads;
      this.roadGrades = candidate.roadGrades;
      this.roadPolicies = candidate.roadPolicies;
      this.signals = candidate.signals;
      this.busLines = candidate.busLines;
      this.activeBusLineId = candidate.activeBusLineId;
      this.nextBusLineId = candidate.nextBusLineId;
      this.refreshPaths();
      this.resetOperation();
      return '';
    }
    preflightCheck(options = {}) {
      const issues = [], reachable = this.homes.map(() => this.goals.map(() => false));
      const coordinates = cell => { const p = this.point(cell); return `(${p.x + 1},${p.y + 1})`; };
      for (const [cell,signal] of this.signals) {
        if (!signal.enabled || signal.automatic) continue;
        const phases = signal.phases.map((actions,index) => ({ index, conflicts: this.signalConflicts(actions) })).filter(phase => phase.conflicts.length);
        if (phases.length) issues.push({
          code: 'signal-conflict', blocking: true, title: '红绿灯放行动作冲突', cells: [cell],
          detail: `路口 ${coordinates(cell)} 的${phases.map(phase => `阶段 ${phase.index + 1}`).join('、')}包含冲突动作，请调整手动灯序后再开始运营。`
        });
      }
      for (let hi = 0; hi < this.homes.length; hi++) for (let gi = 0; gi < this.goals.length; gi++) {
        const home = this.homes[hi], goal = this.goals[gi];
        if (home.route !== goal.route) continue;
        const carPath = this.findCarPath(home.cell, goal.cell);
        reachable[hi][gi] = Boolean(carPath || this.busItineraryFor(hi,gi));
      }
      for (let hi = 0; hi < this.homes.length; hi++) {
        const home = this.homes[hi], route = this.routes[home.route];
        if (!reachable[hi].some(Boolean)) issues.push({
          code: 'home-unreachable', title: '住宅没有可达目的地', cells: [home.cell],
          detail: `${route.name}住宅 ${coordinates(home.cell)} 无法通过道路或有效公交到达同色目的地。`
        });
      }
      for (let ri = 0; ri < this.routes.length; ri++) {
        const homes = this.homes.filter(home => home.route === ri), goals = this.goals.filter(goal => goal.route === ri);
        const population = homes.reduce((sum, home) => sum + home.passengers, 0);
        if (goals.length && goals.every(goal => goal.input != null)) {
          const capacity = goals.reduce((sum, goal) => sum + goal.input, 0);
          if (capacity < population) issues.push({
            code: 'route-capacity', title: '目的地容量不足', cells: goals.map(goal => goal.cell),
            detail: `${this.routes[ri].name}共有 ${population} 位居民，但同色目的地总容量只有 ${capacity} 人：${goals.map(goal => `${goal.label} ${coordinates(goal.cell)} ${goal.input} 人`).join('、')}。`
          });
        }
      }
      for (const line of this.busLines) {
        const problem = this.busLineIssue(line);
        if (problem) {
          issues.push({ code: 'bus-invalid', title: '公交线路不能有效运营', lineId: line.id, cells: this.busRouteCells(line), detail: `${problem}；开始后该线路将不会发车。` });
          continue;
        }
        const homes = this.homes.filter(home => this.busServicePositions(home.cell, line.id).length);
        const goals = this.goals.filter(goal => this.busServicePositions(goal.cell, line.id).length);
        const networkService=this.homes.some((home,hi)=>this.goals.some((goal,gi)=>goal.route===home.route&&this.busItineraryFor(hi,gi)?.legs.some(leg=>leg.lineId===line.id)));
        if (!networkService) issues.push({
          code: 'bus-no-service', title: '公交线路没有有效上下客组合', lineId: line.id, cells: this.busRouteCells(line),
          detail: !homes.length&&!this.busLines.some(other=>other.id!==line.id&&[...line.stops].some(cell=>other.stops.has(cell))) ? `「${line.name}」没有服务住宅或换乘站。` : !goals.length ? `「${line.name}」没有直达目的地，也不能组成有效换乘。` : `「${line.name}」的站序无法把住宅乘客送到同色目的地。`
        });
      }
      const suspicious = [...new Set(Array.isArray(options.suspiciousDowngrades) ? options.suspiciousDowngrades : [])].filter(cell => Number.isInteger(cell) && this.roads.has(cell));
      if (suspicious.length) issues.push({
        code: 'drag-downgrade', title: '拖拽曾降低主路等级', cells: suspicious,
        detail: `${suspicious.map(coordinates).join('、')} 的道路在一次建设拖拽中被降级，请确认这不是误操作。`
      });
      let maxDeliverable = 0;
      for (let ri = 0; ri < this.routes.length; ri++) {
        const homeIndices = this.homes.map((home, index) => home.route === ri ? index : -1).filter(index => index >= 0);
        const goalIndices = this.goals.map((goal, index) => goal.route === ri ? index : -1).filter(index => index >= 0);
        const source = 0, homeStart = 1, goalStart = homeStart + homeIndices.length, sink = goalStart + goalIndices.length;
        const capacity = Array.from({ length: sink + 1 }, () => Array(sink + 1).fill(0));
        homeIndices.forEach((hi, i) => {
          capacity[source][homeStart + i] = this.homes[hi].passengers;
          goalIndices.forEach((gi, j) => { if (reachable[hi][gi]) capacity[homeStart + i][goalStart + j] = this.homes[hi].passengers; });
        });
        goalIndices.forEach((gi, j) => { capacity[goalStart + j][sink] = this.goals[gi].input ?? this.target; });
        while (true) {
          const parent = Array(sink + 1).fill(-1), queue = [source]; parent[source] = source;
          for (let q = 0; q < queue.length && parent[sink] < 0; q++) for (let next = 0; next <= sink; next++) {
            if (parent[next] < 0 && capacity[queue[q]][next] > 0) { parent[next] = queue[q]; queue.push(next); }
          }
          if (parent[sink] < 0) break;
          let amount = Infinity;
          for (let node = sink; node !== source; node = parent[node]) amount = Math.min(amount, capacity[parent[node]][node]);
          for (let node = sink; node !== source; node = parent[node]) { capacity[parent[node]][node] -= amount; capacity[node][parent[node]] += amount; }
          maxDeliverable += amount;
        }
      }
      if (maxDeliverable < this.target) issues.push({
        code: 'target-impossible', title: '理论送达上限低于目标', cells: [],
        detail: `按当前连接、公交站序和目的地容量，理论最多送达 ${maxDeliverable} / ${this.target} 人。`
      });
      return { ok: issues.length === 0, blocking: issues.some(issue => issue.blocking), target: this.target, maxDeliverable, issues };
    }
    toggle() {
      if (this.state === 'planning') {
        if ([...this.signals.values()].some(signal => signal.enabled && !signal.automatic && signal.phases.some(actions => this.signalConflicts(actions).length))) return '地图设计有问题：手动红绿灯包含冲突的放行动作';
        this.spawnBuses(); this.state = 'running';
      } else if (this.state === 'paused') this.state = 'running';
      else if (this.state === 'running') this.state = 'paused';
      return '';
    }
    available(cell, heading, self) {
      return this.laneFor(cell, heading, self) !== -1;
    }
    step(dt) {
      if (this.state !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
      dt = Math.min(dt, 0.1, this.duration - this.elapsed);
      this.elapsed += dt;
      for (let hi = 0; hi < this.homes.length; hi++) {
        const home = this.homes[hi];
        this.spawnTimers[hi] -= dt;
        while (this.spawnTimers[hi] <= 1e-9 && this.generated[hi] < home.passengers) {
          this.generated[hi]++;
          this.queues[hi]++;
          this.queueTimes[hi]?.push(this.elapsed);
          this.spawnTimers[hi] += 1 / home.generationRate;
        }
        this.maxHomeQueues[hi]=Math.max(this.maxHomeQueues[hi]||0,this.queues[hi]);
        if (this.queues[hi]) {
          const { goalIndex, path } = this.bestGoalPath(hi);
          if (goalIndex !== null && path) {
            const heading = path[1] - path[0];
            if (this.available(home.cell, heading) && this.available(path[1], heading)) {
              const commuteStarted = this.queueTimes[hi]?.shift() ?? this.elapsed;
              this.cars.push({ id: this.nextId++, route: home.route, homeIndex: hi, goalIndex, goal: this.goals[goalIndex].cell, commuteStarted, cell: home.cell, next: null, heading, cellHeading: heading, lane: 0, cellLane: 0, cellSlot: 1, progress: 0, blocked: 0, plannedPath:path, replanAt:this.elapsed+ROUTE_REPLAN_INTERVAL, routeChanges:0 });
              this.goalAssigned[goalIndex]++;
              this.departedByHome[hi]++;
              this.queues[hi]--;
            }
          }
        }
      }
      for (const bus of this.buses) this.stepBus(bus, dt);
      this.maxTransferWaiting=Math.max(this.maxTransferWaiting||0,this.transferPassengers().length);
      const plans = new Map();
      for (const car of this.cars) if (!car.done && car.next === null) {
        const goal = car.goal ?? this.defaultGoalCell(car.route), exit = car.cellMovement?.exitCell;
        // Once admitted, finish the committed turn even if other roads change.
        plans.set(car,exit===undefined?this.planCarPath(car):[car.cell,...(this.findCarPath(exit,goal,{dynamic:true,self:car})||[exit])]);
      }
      for(const [node] of this.signals){
        const counts=Object.fromEntries(SIGNAL_ENTRY_ORDER.map(entry=>[entry,0])),entries=signalEntries(this.width);
        for(const car of this.cars){const path=plans.get(car),entry=path&&path[1]===node?SIGNAL_ENTRY_ORDER.find(name=>entries[name]===node-car.cell):null;if(entry)counts[entry]++;}
        const stats=this.junctionStats.get(node)||{entries:Object.fromEntries(SIGNAL_ENTRY_ORDER.map(entry=>[entry,{queueSeconds:0,maxQueue:0,passed:0}]))};
        for(const entry of SIGNAL_ENTRY_ORDER){stats.entries[entry].queueSeconds+=counts[entry]*dt;stats.entries[entry].maxQueue=Math.max(stats.entries[entry].maxQueue,counts[entry]);}
        this.junctionStats.set(node,stats);
      }
      for (const car of this.cars) {
        const path=plans.get(car),n=path?.[1];
        const waiting=car.next===null && car.cellSlot!==0 && this.signals.has(n) && !this.signals.get(n).enabled;
        if (!waiting) {car.yieldNode=null;car.yieldSince=null;}
        else if (car.yieldNode!==n) {car.yieldNode=n;car.yieldSince=this.elapsed;}
      }
      const signalPriority = car => {
        const path = plans.get(car), signal = path ? this.signals.get(path[1]) : null;
        if (!path || path.length < 2 || car.cellSlot === 0 || !signal || signal.enabled || signal.yieldMode !== 'priority') return null;
        const entries = signalEntries(this.width), entry = SIGNAL_ENTRY_ORDER.find(name => entries[name] === path[1]-car.cell);
        return { node: path[1], rank: signal.priority.indexOf(entry) };
      };
      const turnPriority = car => {
        const path = plans.get(car);
        if (!path || path.length < 3 || car.cellSlot === 0 || !this.signals.get(path[1])?.enabled) return 0;
        return this.movement(path[1]-car.cell, path[2]-path[1]).turn === 'right' ? 1 : 0;
      };
      // At priority-controlled junctions, approach rank precedes arrival time.
      // Elsewhere arrival time remains authoritative; right turns still yield.
      for (const car of [...this.cars].sort((a,b) => {
        const ap=signalPriority(a),bp=signalPriority(b);
        if(ap&&bp&&ap.node===bp.node&&ap.rank!==bp.rank)return ap.rank-bp.rank;
        return (a.yieldSince??-Infinity)-(b.yieldSince??-Infinity)||turnPriority(a)-turnPriority(b)||a.id-b.id;
      })) {
        if (car.done) continue;
        if (car.next === null) {
          const path = plans.get(car);
          if (!path || path.length < 2) { car.blocked += dt; continue; }
          const heading = path[1] - car.cell;
          const internal = this.roads.has(car.cell) && !this.signals.has(car.cell) && car.cellSlot === 0;
          const target = internal ? car.cell : path[1];
          const slot = internal || this.signals.has(target) || this.buildings.has(target) ? 1 : 0;
          const exitHeading = path[2] === undefined ? heading : path[2] - target;
          const junctionIndex = internal ? 1 : 2, junction = path[junctionIndex], junctionExit = path[junctionIndex + 1];
          const turn = junctionExit !== undefined && this.signals.has(junction) ? this.movement(junction - target, junctionExit - junction).turn : null;
          const preferred = turn ? this.turnLane(target, turn) : car.cellLane || 0;
          const lane = this.laneFor(target, heading, car, slot, exitHeading, preferred, turn !== null);
          if (lane < 0 || (!internal && !this.canEnter(target, heading, exitHeading))) { car.blocked += dt; continue; }
          if (!internal && this.signals.has(target) && path[2] !== undefined
            && this.laneFor(path[2], exitHeading, car, 0, path[3] === undefined ? exitHeading : path[3] - path[2]) < 0) { car.blocked += dt; continue; }
          car.next = target;
          if(!internal&&this.signals.has(target)){
            const entry=SIGNAL_ENTRY_ORDER.find(name=>signalEntries(this.width)[name]===target-car.cell),stats=this.junctionStats.get(target);
            if(entry&&stats)stats.entries[entry].passed++;
          }
          car.nextSlot = slot;
          car.nextMovement = this.signals.has(target) ? { ...this.movement(heading, exitHeading), exitCell: path[2] } : null;
          car.heading = heading;
          car.lane = lane;
          car.blocked = 0;
          const sourceCentered = this.signals.has(car.cell) || this.buildings.has(car.cell);
          const targetCentered = this.signals.has(target) || this.buildings.has(target);
          car.distance = internal ? .5 : sourceCentered && targetCentered ? 1 : sourceCentered || targetCentered ? .75 : .5;
        }
        const speeds = [car.cell, car.next].filter(n => this.roads.has(n)).map(n => this.roadType(n).speed);
        const yielding=[car.cell,car.next].some(n=>this.signals.has(n)&&!this.signals.get(n).enabled);
        car.progress += dt * (speeds.length ? Math.min(...speeds) : ROAD_TYPES[0].speed) * (yielding ? .35 : 1) / (car.distance || 1);
        if (car.progress >= 1) {
          car.cell = car.next;
          car.cellHeading = car.heading;
          car.cellLane = car.lane;
          car.cellSlot = car.nextSlot ?? 0;
          car.cellMovement = car.nextMovement;
          car.nextMovement = null;
          car.next = null;
          car.progress = 0;
          if (car.cell === car.goal) {
            car.done = true;
            this.delivered++;
            this.byRoute[car.route]++;
            if (car.goalIndex != null) this.byGoal[car.goalIndex]++;
            const commuteTime = Math.max(0, this.elapsed - (car.commuteStarted ?? this.elapsed));
            this.commuteTimes.push(commuteTime);
            this.arrivals.push({ route: car.route, goal: car.goal, goalIndex: car.goalIndex, time: this.elapsed, commuteTime });
          }
        }
      }
      this.cars = this.cars.filter(c => !c.done);
      for(const vehicle of [...this.cars,...this.buses])if(vehicle.active!==false&&this.roads.has(vehicle.cell)){
        const stats=this.roadStats.get(vehicle.cell)||{occupancySeconds:0,blockedSeconds:0};stats.occupancySeconds+=dt;if(vehicle.blocked>0)stats.blockedSeconds+=dt;this.roadStats.set(vehicle.cell,stats);
      }
      if (!this.sandbox && !this.deadlineMode && this.delivered >= this.target) this.state = 'won';
      else if (!this.sandbox && this.elapsed >= this.duration) this.state = this.delivered >= this.target ? 'won' : 'lost';
    }
  }
  installBusMethods(City, { BUS_CAPACITY, BUS_SPEED_MULTIPLIER, BUS_BOARDING_RATE, BUS_COST, BUS_LINE_COLORS });
  api = { City, ROAD_TYPES, SIGNAL_CLEARANCE, PHASES, SIGNAL_ACTIONS, SIGNAL_ENTRY_ORDER, VEHICLE_WIDTH, VEHICLE_LENGTH, BUS_WIDTH, BUS_LENGTH, LANE_WIDTH, ROUTE_REPLAN_INTERVAL, ROUTE_SWITCH_RATIO, BUS_CAPACITY, BUS_SPEED_MULTIPLIER, BUS_BOARDING_RATE, BUS_COST, movement, movementsConflict, vehiclePosition, LEVELS, CHAPTERS, setLevels, routeHomes, routeGoals, WIDTH, HEIGHT, MIN_MAP_SIZE, MAX_MAP_SIZE, BUDGET, DURATION, TARGET, ROUTES, key, point, neighbors, findPath, findWeightedPath };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    Object.assign(api, require('./core-campaign.js')(api));
  } else root.TrafficCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
