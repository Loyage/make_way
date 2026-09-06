/* Shared, DOM-free simulation. Works offline in browsers and in Node tests. */
(function (root) {
  'use strict';
  const WIDTH = 16, HEIGHT = 12;
  const key = (x, y) => y * WIDTH + x;
  const point = n => ({ x: n % WIDTH, y: Math.floor(n / WIDTH) });
  const LEVELS = typeof module !== 'undefined' && module.exports ? require('./levels.js') : root.TrafficLevels;
  // Default scenario and convenience exports follow the first lesson.
  const { budget: BUDGET, duration: DURATION, target: TARGET, routes: ROUTES } = LEVELS[0];
  function neighbors(n) {
    const { x, y } = point(n), out = [];
    if (x > 0) out.push(n - 1);
    if (x < WIDTH - 1) out.push(n + 1);
    if (y > 0) out.push(n - WIDTH);
    if (y < HEIGHT - 1) out.push(n + WIDTH);
    return out;
  }
  function findPath(roads, start, goal, edges = null) {
    if (start === goal) return [start];
    const queue = [start], prev = new Map([[start, null]]);
    for (let i = 0; i < queue.length; i++) {
      for (const n of edges ? (edges.get(queue[i]) || []) : neighbors(queue[i])) {
        if (prev.has(n) || (n !== goal && !roads.has(n))) continue;
        prev.set(n, queue[i]);
        if (n === goal) {
          const path = [n];
          while (path[0] !== start) path.unshift(prev.get(path[0]));
          return path;
        }
        queue.push(n);
      }
    }
    return null;
  }
  const ROAD_TYPES = Object.freeze([
    Object.freeze({ name: '支路', cost: 1, speed: 2.8, lanes: 1, capacity: 2, width: .30, color: '#b3bfa7' }),
    Object.freeze({ name: '干道', cost: 2, speed: 4, lanes: 2, capacity: 4, width: .54, color: '#8da79c' }),
    Object.freeze({ name: '快速路', cost: 3, speed: 5.2, lanes: 3, capacity: 6, width: .78, color: '#708b9b' })
  ]);
  const SIGNAL_CLEARANCE = 0.25;
  const VEHICLE_WIDTH = .085, VEHICLE_LENGTH = .28, LANE_WIDTH = .12;
  const PHASES = Object.freeze(['horizontal-straight', 'horizontal-left', 'vertical-straight', 'vertical-left']);
  const vector = heading => ({ x: Math.abs(heading) === 1 ? Math.sign(heading) : 0, y: Math.abs(heading) === WIDTH ? Math.sign(heading) : 0 });
  function movement(entry, exit = entry) {
    const a = vector(entry), b = vector(exit), cross = a.x * b.y - a.y * b.x;
    const turn = exit === entry ? 'straight' : cross > 0 ? 'right' : 'left';
    // Clockwise quadrants: NW, NE, SE, SW. Right-hand traffic enters
    // the first quadrant, traverses two for straight and three for left.
    const first = ({ [WIDTH]: 0, [-1]: 1, [-WIDTH]: 2, [1]: 3 })[entry];
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
  function vehiclePosition(n, heading, lane, slot, centered = false) {
    const p = point(n), d = vector(heading), along = centered ? 0 : slot === 0 ? -.25 : .25;
    const side = (lane + .5) * LANE_WIDTH;
    return { x: p.x + .5 + d.x * along - d.y * side, y: p.y + .5 + d.y * along + d.x * side };
  }
  class City {
    constructor(levelId = LEVELS[0].id) {
      this.level = LEVELS.find(level => level.id === levelId);
      if (!this.level) throw new RangeError(`Unknown level: ${levelId}`);
      this.routes = this.level.routes;
      this.water = new Set(this.level.water);
      this.bridges = new Set(this.level.bridges);
      this.roads = new Set(this.bridges);
      this.edges = new Map();
      for (const n of this.bridges) for (const v of neighbors(n)) if (this.bridges.has(v)) this.addEdge(n,v);
      this.roadGrades = new Map();
      this.signals = new Map();
      this.trees = new Set(this.level.trees);
      this.buildings = new Set(this.routes.flatMap(r => [r.home, r.goal]));
      this.queues = this.routes.map(() => 0);
      this.queueTimes = this.routes.map(() => []);
      this.spawnTimers = this.routes.map(r => 1 / r.rate);
      this.cars = [];
      this.elapsed = 0;
      this.delivered = 0;
      this.byRoute = this.routes.map(() => 0);
      this.commuteTimes = [];
      this.arrivals = [];
      this.state = 'planning';
      this.nextId = 1;
      this.paths = [];
      this.generated = this.routes.map(() => 0);
      this.refreshPaths();
      for (const [a,b,grade = 0] of this.level.initialEdges || []) {
        const error = this.connect(a,b,grade);
        if (error) throw new Error(`Invalid initial road: ${error}`);
      }
    }
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
      if (['won','lost'].includes(this.state)) return '本局已结束';
      if (!Number.isInteger(a) || !Number.isInteger(b) || a<0 || b<0 || a>=WIDTH*HEIGHT || b>=WIDTH*HEIGHT || !neighbors(a).includes(b)) return '请沿相邻方格拖动';
      if (this.buildings.has(a) && this.buildings.has(b)) return '建筑之间需要道路';
      if (!this.edges.get(a)?.has(b) && [a,b].some(n=>this.roads.has(n) && this.links(n).length===2 && this.occupants(n).length)) return '请等车辆通过后再增设路口';
      const roads=new Set(this.roads), grades=new Map(this.roadGrades);
      for (const n of [a,b]) if (!this.buildings.has(n)) {
        const error=this.edit(n,false,grade);
        if (error) {this.roads=roads;this.roadGrades=grades;this.refreshPaths();return error;}
      }
      this.addEdge(a,b);this.refreshPaths();return '';
    }
    cut(a,b) {
      if (['won','lost'].includes(this.state)) return '本局已结束';
      if (!this.edges.get(a)?.has(b)) return '';
      if (this.edgeLocked(a,b)) return '车辆正在通过或已预约这段连接，请稍后剪断';
      if ([a,b].some(n=>this.signals.has(n) && this.links(n).length===3 && this.occupants(n).length)) return '请等车辆通过后再改变路口';
      this.removeEdge(a,b);this.refreshPaths();return '';
    }
    roadType(n) { return ROAD_TYPES[this.roadGrades.get(n) || 0]; }
    get remaining() {
      let spent = 0;
      for (const n of this.roads) spent += this.roadType(n).cost - Number(this.bridges.has(n));
      return this.level.budget - spent;
    }
    refreshPaths() {
      this.paths = this.routes.map(r => findPath(this.roads, r.home, r.goal, this.edges));
      const junctions = new Set([...this.roads].filter(n => this.links(n).length >= 3));
      for (const n of this.signals.keys()) if (!junctions.has(n)) this.signals.delete(n);
      for (const n of junctions) if (!this.signals.has(n)) this.signals.set(n, { enabled: false, green: 2 });
    }
    setSignal(n, enabled, green = 2) {
      if (['won', 'lost'].includes(this.state)) return '本局已结束';
      if (!this.signals.has(n)) return '请选择三岔或十字路口';
      if (typeof enabled !== 'boolean' || ![2, 4, 6].includes(green)) return '无效的信号设置';
      if (this.signals.get(n).enabled !== enabled && this.occupants(n).length) return '请等路口车辆通过后再切换控制方式';
      this.signals.set(n, { enabled, green });
      return '';
    }
    signalPhase(n) {
      const signal = this.signals.get(n);
      if (!signal || !signal.enabled) return { axis: 'off', turn: 'off', stage: 'off', remaining: 0 };
      const span = signal.green + SIGNAL_CLEARANCE;
      const t = this.elapsed % (span * 4), local = t % span;
      const stage = PHASES[Math.floor(t / span)];
      const [axis, turn] = stage.split('-');
      return local >= signal.green
        ? { axis: 'clearance', turn: 'clearance', stage: 'clearance', remaining: span - local }
        : { axis, turn, stage, remaining: signal.green - local };
    }
    canEnter(n, heading, exitHeading = heading) {
      const phase = this.signalPhase(n), move = movement(heading, exitHeading);
      return move.turn === 'right' || phase.axis === 'off'
        || (phase.axis === (Math.abs(heading) === 1 ? 'horizontal' : 'vertical') && phase.turn === move.turn);
    }
    occupants(n, self) { return this.cars.filter(c => !c.done && c !== self && (c.cell === n || c.next === n)); }
    reservations(car) {
      const slots = [{ cell: car.cell, heading: car.cellHeading ?? car.heading, lane: car.cellLane || 0, slot: car.cellSlot ?? 1, movement: car.cellMovement }];
      if (car.next !== null) slots.push({ cell: car.next, heading: car.heading, lane: car.lane || 0, slot: car.nextSlot ?? 0, movement: car.nextMovement });
      return slots;
    }
    junctionAvailable(n, move, self) {
      if (!this.signals.get(n)?.enabled) return this.occupants(n,self).length===0;
      return !this.occupants(n, self).some(c => this.reservations(c).some(r => r.cell === n && movementsConflict(move, r.movement || { mask: 15 })));
    }
    laneFor(n, heading, self, slot = 0, exitHeading = heading, preferred = 0) {
      if (this.signals.has(n)) return this.junctionAvailable(n, movement(heading, exitHeading), self) ? 0 : -1;
      const cars = this.occupants(n, self);
      if (!this.roads.has(n)) return cars.length ? -1 : 0;
      const lanes = this.roadType(n).lanes;
      for (let i = 0; i < lanes; i++) {
        const lane = (preferred + i) % lanes;
        if (!cars.some(c => this.reservations(c).some(r => r.cell === n && r.heading === heading && r.lane === lane && r.slot === slot))) return lane;
      }
      return -1;
    }
    load(n) {
      const cars = this.occupants(n);
      if (this.signals.has(n)) {
        if (!this.signals.get(n).enabled) return { used: cars.length, capacity: 1, total: cars.length, ratio: cars.length };
        let mask = 0;
        for (const car of cars) for (const r of this.reservations(car)) if (r.cell === n) mask |= r.movement?.mask ?? 15;
        const used = [1,2,4,8].filter(bit => mask & bit).length;
        return { used, capacity: 4, total: cars.length, ratio: used / 4 };
      }
      const used = Math.max(0, ...[1,-1,WIDTH,-WIDTH].map(h => cars.filter(c => this.reservations(c).some(r => r.cell === n && r.heading === h)).length));
      const capacity = this.roadType(n).capacity;
      return { used, capacity, total: cars.length, ratio: used / capacity };
    }
    exitLocked(n) {
      return this.cars.some(c => !c.done && [c.cellMovement, c.nextMovement].some(m => m?.exitCell === n));
    }
    anchor(n, heading, lane, slot, move) {
      const position = vehiclePosition(n, heading, lane, slot, this.signals.has(n) || this.buildings.has(n));
      let direction = vector(heading);
      if (this.signals.has(n) && move && move.turn !== 'straight' && move.entry !== -move.exit) {
        const a = vector(move.entry), b = vector(move.exit), p = point(n);
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
    edit(n, erase = false, grade = 0) {
      if (!Number.isInteger(n) || n < 0 || n >= WIDTH * HEIGHT || this.state === 'won' || this.state === 'lost') return '';
      if (!Number.isInteger(grade) || !ROAD_TYPES[grade]) return '无效的道路等级';
      if (this.bridges.has(n) && erase) return '桥梁是固定道路，不能拆除，但可以升级';
      if (this.buildings.has(n)) return '把道路修到建筑旁边，即可连接';
      if (erase) {
        if (!this.roads.has(n)) return '';
        if (this.occupants(n).length || this.exitLocked(n)) return '这里有车辆或路口出口预约，请等车辆通过后再拆除';
        if (this.links(n).some(v => this.signals.has(v) && this.links(v).length === 3 && this.occupants(v).length)) return '相邻路口有车辆，请等车辆通过后再改变路口';
        for (const v of this.links(n)) this.removeEdge(n,v);
        this.roads.delete(n);
        this.roadGrades.delete(n);
      } else {
        const exists = this.roads.has(n), oldGrade = this.roadGrades.get(n) || 0;
        if (exists && oldGrade === grade) return '';
        if (!exists && this.water.has(n)) return '河流上不能修路，请连接现有桥梁';
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
      this.queues = this.routes.map(() => 0);
      this.queueTimes = this.routes.map(() => []);
      this.generated = this.routes.map(() => 0);
      this.spawnTimers = this.routes.map(r => 1 / r.rate);
      this.cars = [];
      this.elapsed = 0;
      this.delivered = 0;
      this.byRoute = this.routes.map(() => 0);
      this.commuteTimes = [];
      this.arrivals = [];
      this.state = 'planning';
      this.nextId = 1;
    }
    stop() {
      if (this.state !== 'running' && this.state !== 'paused') return false;
      this.resetOperation();
      return true;
    }
    serializeDesign() {
      return {
        version: 2,
        edges: [...this.edges].flatMap(([a,vs])=>[...vs].filter(b=>a<b).map(b=>[a,b])).sort(([a,b],[c,d])=>a-c||b-d),
        levelId: this.level.id,
        roads: [...this.roads].sort((a, b) => a - b).map(cell => ({ cell, grade: this.roadGrades.get(cell) || 0 })),
        signals: [...this.signals].sort(([a], [b]) => a - b).map(([cell, signal]) => ({ cell, enabled: signal.enabled, green: signal.green }))
      };
    }
    loadDesign(design) {
      if (!design || ![1,2].includes(design.version) || design.levelId !== this.level.id || !Array.isArray(design.roads) || !Array.isArray(design.signals)) return '存档格式无效或不属于当前关卡';
      const candidate = new City(this.level.id), seenRoads = new Set(), seenSignals = new Set();
      candidate.roads = new Set(candidate.bridges);candidate.roadGrades.clear();candidate.edges.clear();candidate.signals.clear();
      candidate.refreshPaths();
      for (const road of design.roads) {
        if (!road || !Number.isInteger(road.cell) || road.cell < 0 || road.cell >= WIDTH * HEIGHT
          || !Number.isInteger(road.grade) || !ROAD_TYPES[road.grade] || seenRoads.has(road.cell)) return '存档中的道路数据无效';
        seenRoads.add(road.cell);
        const message = candidate.edit(road.cell, false, road.grade);
        if (message) return `无法读取设计：${message}`;
      }
      if (design.version===1) {
        // Older designs intentionally connected every adjacent road/building.
        for (const n of candidate.roads) for (const v of neighbors(n)) if (candidate.roads.has(v)||candidate.buildings.has(v)) candidate.addEdge(n,v);
      } else {
        if (!Array.isArray(design.edges)) return '存档缺少道路连接';
        candidate.edges.clear();const seen=new Set();
        for (const pair of design.edges) {
          if (!Array.isArray(pair)||pair.length!==2) return '存档中的连接无效';
          const [a,b]=pair,id=`${Math.min(a,b)}:${Math.max(a,b)}`;
          if (!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=WIDTH*HEIGHT||b>=WIDTH*HEIGHT||!neighbors(a).includes(b)||seen.has(id)
            ||![a,b].every(n=>candidate.roads.has(n)||candidate.buildings.has(n))||[a,b].every(n=>candidate.buildings.has(n))) return '存档中的连接无效';
          candidate.addEdge(a,b);seen.add(id);
        }
      }
      candidate.refreshPaths();
      for (const saved of design.signals) {
        if (!saved || !Number.isInteger(saved.cell) || seenSignals.has(saved.cell)
          || typeof saved.enabled !== 'boolean' || ![2, 4, 6].includes(saved.green)
          || !candidate.signals.has(saved.cell)) return '存档中的信号灯数据无效';
        seenSignals.add(saved.cell);
        candidate.signals.set(saved.cell, { enabled: saved.enabled, green: saved.green });
      }
      this.edges = candidate.edges;
      this.roads = candidate.roads;
      this.roadGrades = candidate.roadGrades;
      this.signals = candidate.signals;
      this.refreshPaths();
      this.resetOperation();
      return '';
    }
    toggle() {
      if (this.state === 'planning' || this.state === 'paused') this.state = 'running';
      else if (this.state === 'running') this.state = 'paused';
    }
    available(cell, heading, self) {
      return this.laneFor(cell, heading, self) !== -1;
    }
    step(dt) {
      if (this.state !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
      dt = Math.min(dt, 0.1, this.level.duration - this.elapsed);
      this.elapsed += dt;
      this.routes.forEach((r, i) => {
        this.spawnTimers[i] -= dt;
        if (this.spawnTimers[i] <= 1e-9 && this.generated[i] < r.passengers) {
          this.generated[i]++;
          this.queues[i]++;
          this.queueTimes[i]?.push(this.elapsed);
          this.spawnTimers[i] += 1 / r.rate;
        }
        const path = this.paths[i];
        if (this.queues[i] && path) {
          const heading = path[1] - path[0];
          if (this.available(r.home, heading) && this.available(path[1], heading)) {
            const commuteStarted = this.queueTimes[i]?.shift() ?? this.elapsed;
            this.cars.push({ id: this.nextId++, route: i, commuteStarted, cell: r.home, next: null, heading, cellHeading: heading, lane: 0, cellLane: 0, cellSlot: 1, progress: 0, blocked: 0 });
            this.queues[i]--;
          }
        }
      });
      const plans = new Map();
      for (const car of this.cars) if (!car.done && car.next === null) {
        const goal = this.routes[car.route].goal, exit = car.cellMovement?.exitCell;
        // Once admitted, finish the committed turn even if other roads change.
        plans.set(car, exit === undefined ? findPath(this.roads, car.cell, goal, this.edges)
          : [car.cell, ...(findPath(this.roads, exit, goal, this.edges) || [exit])]);
      }
      for (const car of this.cars) {
        const path=plans.get(car),n=path?.[1];
        const waiting=car.next===null && car.cellSlot!==0 && this.signals.has(n) && !this.signals.get(n).enabled;
        if (!waiting) {car.yieldNode=null;car.yieldSince=null;}
        else if (car.yieldNode!==n) {car.yieldNode=n;car.yieldSince=this.elapsed;}
      }
      const priority = car => {
        const path = plans.get(car);
        if (!path || path.length < 3 || car.cellSlot === 0 || !this.signals.get(path[1])?.enabled) return 0;
        return movement(path[1]-car.cell, path[2]-path[1]).turn === 'right' ? 1 : 0;
      };
      // Uncommitted right turns yield to eligible straight/left traffic this
      // tick; admitted vehicles keep their reservations and clear normally.
      for (const car of [...this.cars].sort((a,b) => (a.yieldSince ?? -Infinity)-(b.yieldSince ?? -Infinity) || priority(a)-priority(b) || a.id-b.id)) {
        if (car.done) continue;
        if (car.next === null) {
          const path = plans.get(car);
          if (!path || path.length < 2) { car.blocked += dt; continue; }
          const heading = path[1] - car.cell;
          const internal = this.roads.has(car.cell) && !this.signals.has(car.cell) && car.cellSlot === 0;
          const target = internal ? car.cell : path[1];
          const slot = internal || this.signals.has(target) || this.buildings.has(target) ? 1 : 0;
          const exitHeading = path[2] === undefined ? heading : path[2] - target;
          const lane = this.laneFor(target, heading, car, slot, exitHeading, car.cellLane || 0);
          if (lane < 0 || (!internal && !this.canEnter(target, heading, exitHeading))) { car.blocked += dt; continue; }
          if (!internal && this.signals.has(target) && path[2] !== undefined
            && this.laneFor(path[2], exitHeading, car, 0, path[3] === undefined ? exitHeading : path[3] - path[2]) < 0) { car.blocked += dt; continue; }
          car.next = target;
          car.nextSlot = slot;
          car.nextMovement = this.signals.has(target) ? { ...movement(heading, exitHeading), exitCell: path[2] } : null;
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
          if (car.cell === this.routes[car.route].goal) {
            car.done = true;
            this.delivered++;
            this.byRoute[car.route]++;
            const commuteTime = Math.max(0, this.elapsed - (car.commuteStarted ?? this.elapsed));
            this.commuteTimes.push(commuteTime);
            this.arrivals.push({ route: car.route, time: this.elapsed, commuteTime });
          }
        }
      }
      this.cars = this.cars.filter(c => !c.done);
      if (this.delivered >= this.level.target) this.state = 'won';
      else if (this.elapsed >= this.level.duration) this.state = 'lost';
    }
  }
  const api = { City, ROAD_TYPES, SIGNAL_CLEARANCE, PHASES, VEHICLE_WIDTH, VEHICLE_LENGTH, LANE_WIDTH, movement, movementsConflict, vehiclePosition, LEVELS, WIDTH, HEIGHT, BUDGET, DURATION, TARGET, ROUTES, key, point, neighbors, findPath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
