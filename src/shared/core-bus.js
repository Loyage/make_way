(function (root, factory) {
  'use strict';
  const installBusMethods = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = installBusMethods;
  else root.TrafficBus = { installBusMethods };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return function installBusMethods(City, constants) {
    const { BUS_CAPACITY, BUS_SPEED_MULTIPLIER, BUS_BOARDING_RATE, BUS_COST, BUS_LINE_COLORS } = constants;
    class BusMethods {
    get busLineLimit() { return Number.isInteger(this.level.busLineLimit) ? this.level.busLineLimit : 1; }
    busLine(lineId = this.activeBusLineId) { return this.busLines.find(line => line.id === lineId) || null; }
    get activeBusLine() { return this.busLine(); }
    busRouteCells(line) {
      if (!line?.route.length) return [];
      return line.route[0] === line.route[line.route.length - 1] ? line.route.slice(0, -1) : [...line.route];
    }
    busOperatingRoute(line) {
      if (!line?.route.length) return [];
      const closed = line.route.length >= 3 && line.route[0] === line.route[line.route.length - 1];
      return line.returnTrip && !closed ? [...line.route, ...line.route.slice(0, -1).reverse()] : [...line.route];
    }
    busLineIssue(line) {
      if (!line.route.length) return `「${line.name}」尚未绘制线路`;
      const closed = line.route.length >= 3 && line.route[0] === line.route[line.route.length - 1];
      if (!line.returnTrip && !closed) return `「${line.name}」尚未闭环，请从线路末端继续绘制`;
      if (line.route.length < 2) return `「${line.name}」至少需要经过两格道路`;
      if (new Set(this.busRouteCells(line)).size < line.count) return `「${line.name}」经过的不同道路格不能少于公交车数量`;
      return '';
    }
    busLineProblem() {
      for (const line of this.busLines) {
        const problem = this.busLineIssue(line);
        if (problem) return problem;
      }
      return '';
    }
    busLineOperational(line) { return Boolean(line && !this.busLineIssue(line)); }
    busServicePositions(buildingCell, lineId = this.activeBusLineId) {
      const line = this.busLine(lineId);
      if (!line || !this.buildings.has(buildingCell)) return [];
      const route = this.busOperatingRoute(line), outboundLimit = line.route[0] === line.route[line.route.length - 1] ? route.length - 1 : line.route.length;
      const positions = [];
      for (let i = 0; i < route.length - 1; i++) if (line.stops.has(route[i]) && this.neighbors(buildingCell).includes(route[i]) && (i < outboundLimit || line.returnStops)) positions.push(i);
      return positions;
    }
    busCanServe(homeCell, goalCell, line) {
      if (!this.busLineOperational(line)) return false;
      const homePositions = this.busServicePositions(homeCell, line.id), goalPositions = this.busServicePositions(goalCell, line.id), segments = this.busOperatingRoute(line).length - 1;
      if (!homePositions.length || !goalPositions.length || segments < 1) return false;
      return homePositions.some(homePosition => goalPositions.some(goalPosition => (goalPosition - homePosition + segments) % segments > 0));
    }
    // Compatibility aliases keep older integrations focused on the selected line.
    get busRoute() { return this.activeBusLine?.route || []; }
    get busCount() { return this.activeBusLine?.count || 1; }
    createBusLine(name, color) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!this.level.features.bus) return '公交线路在本关未开放';
      if (this.busLines.length >= this.busLineLimit) return `本关最多可规划 ${this.busLineLimit} 条公交线路`;
      const number = this.busLines.length + 1, lineName = name === undefined ? `公交 ${number} 号线` : typeof name === 'string' ? name.trim() : '';
      const lineColor = color === undefined ? BUS_LINE_COLORS[(number - 1) % BUS_LINE_COLORS.length] : color;
      if (!lineName || lineName.length > 20) return '线路名称须为 1 至 20 个字符';
      if (typeof lineColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(lineColor)) return '线路颜色无效';
      const id = `line-${this.nextBusLineId++}`;
      this.busLines.push({ id, name: lineName, color: lineColor.toLowerCase(), route: [], count: 1, stops: new Set(), returnTrip: false, returnStops: false, headway: 4, stats: null });
      this.activeBusLineId = id;
      return '';
    }
    ensureBusLine() {
      if (this.activeBusLine) return '';
      return this.createBusLine();
    }
    selectBusLine(lineId) {
      if (!this.busLine(lineId)) return '公交线路不存在';
      this.activeBusLineId = lineId;
      return '';
    }
    updateBusLine(lineId, settings) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      const line = this.busLine(lineId);
      if (!line || !settings || typeof settings !== 'object') return '公交线路不存在';
      const candidate = { name: line.name, color: line.color, returnTrip: line.returnTrip, returnStops: line.returnStops, headway: line.headway };
      if (settings.name !== undefined) {
        const name = typeof settings.name === 'string' ? settings.name.trim() : '';
        if (!name || name.length > 20) return '线路名称须为 1 至 20 个字符';
        candidate.name = name;
      }
      if (settings.color !== undefined) {
        if (typeof settings.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(settings.color)) return '线路颜色无效';
        candidate.color = settings.color.toLowerCase();
      }
      if (settings.returnTrip !== undefined) {
        if (typeof settings.returnTrip !== 'boolean') return '原路返回设置无效';
        if (settings.returnTrip && line.route.length >= 3 && line.route[0] === line.route[line.route.length - 1]) return '线路已经闭环，无需开启原路返回';
        candidate.returnTrip = settings.returnTrip;
        if (!settings.returnTrip) candidate.returnStops = false;
      }
      if (settings.returnStops !== undefined) {
        if (typeof settings.returnStops !== 'boolean' || settings.returnStops && !(settings.returnTrip ?? line.returnTrip)) return '返程停站只能用于原路返回线路';
        candidate.returnStops = settings.returnStops;
      }
      if (settings.headway !== undefined) {
        if (![2,4,6,8].includes(settings.headway)) return '发车间隔须为 2、4、6 或 8 秒';
        candidate.headway = settings.headway;
      }
      Object.assign(line, candidate);
      return '';
    }
    deleteBusLine(lineId = this.activeBusLineId) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      const index = this.busLines.findIndex(line => line.id === lineId);
      if (index < 0) return '公交线路不存在';
      this.busLines.splice(index, 1);
      this.activeBusLineId = this.busLines[index]?.id || this.busLines[index - 1]?.id || null;
      return '';
    }
    setBusRoute(path, lineId = this.activeBusLineId) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!this.level.features.bus) return '公交线路在本关未开放';
      if (!Array.isArray(path)) return '公交线路无效';
      if (!lineId) { const message = this.ensureBusLine(); if (message) return message; lineId = this.activeBusLineId; }
      const line = this.busLine(lineId);
      if (!line) return '公交线路不存在';
      if (!path.length) { line.route = []; line.stops.clear(); return ''; }
      if (path.length < 2) return '公交线路每段至少需要经过两格道路';
      if (path.some(n => !Number.isInteger(n) || !this.roads.has(n))) return '公交线路只能经过已有道路';
      for (let i = 1; i < path.length; i++) if (!this.edges.get(path[i - 1])?.has(path[i])) return '公交线路必须沿已经连通的道路绘制';
      if (!line.route.length && this.remaining < line.count * BUS_COST) return `公交车辆需要 ${line.count * BUS_COST} 点预算`;
      line.route = [...path];
      if (line.route.length >= 3 && line.route[0] === line.route[line.route.length - 1]) line.returnTrip = false;
      line.stops = new Set(this.busRouteCells(line).filter(cell => this.neighbors(cell).some(n => this.buildings.has(n))));
      return '';
    }
    appendBusRoute(path, lineId = this.activeBusLineId) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!this.level.features.bus) return '公交线路在本关未开放';
      if (!Array.isArray(path) || path.length < 2) return '本段公交线路至少需要经过两格道路';
      const line = this.busLine(lineId);
      if (!line?.route.length) return this.setBusRoute(path, lineId);
      if (line.route[0] === line.route[line.route.length - 1]) return '线路已经闭环；如需修改，请先反向擦除尾段';
      if (path[0] !== line.route[line.route.length - 1]) return '请从当前线路末端继续绘制';
      const previousStops = new Set(line.stops), previousCells = new Set(this.busRouteCells(line));
      const message = this.setBusRoute([...line.route, ...path.slice(1)], lineId);
      if (message) return message;
      for (const cell of previousCells) if (!previousStops.has(cell)) line.stops.delete(cell);
      return '';
    }
    trimBusRoute(path, lineId = this.activeBusLineId) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!this.level.features.bus) return '公交线路在本关未开放';
      if (!Array.isArray(path) || path.length < 2) return '请从线路末端反向擦除至少一段';
      const line = this.busLine(lineId);
      if (!line?.route.length) return '当前线路尚未绘制';
      const reversed = line.route.slice().reverse();
      if (path.some((cell, index) => cell !== reversed[index])) return '只能从线路末端沿原路径反向擦除';
      const previousStops = new Set(line.stops), remaining = line.route.slice(0, line.route.length - path.length + 1);
      const message = this.setBusRoute(remaining.length >= 2 ? remaining : [], lineId);
      if (message) return message;
      for (const cell of this.busRouteCells(line)) if (!previousStops.has(cell)) line.stops.delete(cell);
      return '';
    }
    setBusCount(count, lineId = this.activeBusLineId) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      if (!this.level.features.bus) return '公交线路在本关未开放';
      if (!Number.isInteger(count) || count < 1 || count > 3) return '每条线路可配置 1 至 3 辆公交车';
      if (!lineId) { const message = this.ensureBusLine(); if (message) return message; lineId = this.activeBusLineId; }
      const line = this.busLine(lineId);
      if (!line) return '公交线路不存在';
      if (line.route.length && this.remaining < (count - line.count) * BUS_COST) return `增加公交车辆需要 ${(count - line.count) * BUS_COST} 点预算`;
      line.count = count;
      return '';
    }
    busStopPositions(buildingCell, lineId = this.activeBusLineId) {
      const line = this.busLine(lineId);
      if (!line || !this.buildings.has(buildingCell)) return [];
      const positions = [];
      const limit = line.route[0] === line.route[line.route.length - 1] ? line.route.length - 1 : line.route.length;
      for (let i = 0; i < limit; i++) if (line.stops.has(line.route[i]) && this.neighbors(buildingCell).includes(line.route[i])) positions.push(i);
      return positions;
    }
    linesAtCell(cell) { return this.busLines.filter(line => this.busRouteCells(line).includes(cell)); }
    linesServingBuilding(cell) { return this.busLines.filter(line => this.busServicePositions(cell, line.id).length); }
    resetBusStats() {
      for (const line of this.busLines) line.stats = { boarded: 0, alighted: 0, rejectedFull: 0, passengerSeconds: 0, vehicleSeconds: 0, cycles: 0, stops: {} };
    }
    busStopDemand(cell, lineId = this.activeBusLineId) {
      const line = this.busLine(lineId);if(!line?.stops.has(cell))return 0;
      return this.homes.reduce((sum,home,index)=>sum+(this.neighbors(home.cell).includes(cell)&&this.goals.some(goal=>goal.route===home.route&&this.busCanServe(home.cell,goal.cell,line))?this.queues[index]:0),0);
    }
    busReports() {
      return this.busLines.map(line=>{
        const stats=line.stats||{boarded:0,alighted:0,rejectedFull:0,passengerSeconds:0,vehicleSeconds:0,cycles:0,stops:{}};
        return { id:line.id,name:line.name,boarded:stats.boarded,alighted:stats.alighted,rejectedFull:stats.rejectedFull,cycles:stats.cycles,
          averageLoad:stats.vehicleSeconds?stats.passengerSeconds/stats.vehicleSeconds:0,averageLoadRate:stats.vehicleSeconds?stats.passengerSeconds/(stats.vehicleSeconds*BUS_CAPACITY):0,stops:stats.stops };
      });
    }
    isBusStop(cell, lineId = this.activeBusLineId) { return Boolean(this.busLine(lineId)?.stops.has(cell)); }
    canSetBusStop(cell, lineId = this.activeBusLineId) { return this.busRouteCells(this.busLine(lineId)).includes(cell); }
    setBusStop(cell, enabled, lineId = this.activeBusLineId) {
      if (this.state !== 'planning') return ['won','lost'].includes(this.state) ? '本局已结束' : '运营期间不能修改规划，请先停止运营';
      const line = this.busLine(lineId);
      if (!this.level.features.bus || !line?.route.length) return '请先规划公交线路';
      if (!this.canSetBusStop(cell, lineId) || typeof enabled !== 'boolean') return '公交站只能设置在线路经过的道路格';
      if (enabled) line.stops.add(cell); else line.stops.delete(cell);
      return '';
    }
    busGoalFor(home, routePosition, lineId) {
      const line = this.busLine(lineId), segments = this.busOperatingRoute(line).length - 1;
      let selected = null, distance = Infinity;
      for (let gi = 0; gi < this.goals.length; gi++) {
        const goal = this.goals[gi];
        if (goal.route !== home.route || goal.input != null && this.goalAssigned[gi] >= goal.input) continue;
        for (const position of this.busServicePositions(goal.cell, lineId)) {
          const forward = (position - routePosition + segments) % segments || segments;
          if (forward > 0 && forward < distance) { selected = gi; distance = forward; }
        }
      }
      return selected;
    }
    finishBusPassenger(passenger) {
      const goal = this.goals[passenger.goalIndex];
      this.delivered++;
      this.byRoute[passenger.route]++;
      this.byGoal[passenger.goalIndex]++;
      const commuteTime = Math.max(0, this.elapsed - passenger.commuteStarted);
      this.commuteTimes.push(commuteTime);
      this.arrivals.push({ route: passenger.route, goal: goal.cell, goalIndex: passenger.goalIndex, time: this.elapsed, commuteTime, vehicle: 'bus' });
    }
    serviceBusStop(bus) {
      const line = this.busLine(bus.lineId), route = this.busOperatingRoute(line), outboundLimit = line?.route[0] === line?.route[line.route.length - 1] ? route.length - 1 : line?.route.length;
      let moved = 0;
      if (!line?.stops.has(bus.cell) || bus.routePosition >= outboundLimit && !line.returnStops) { bus.needsStop = false; return; }
      const stats=line.stats||(line.stats={boarded:0,alighted:0,rejectedFull:0,passengerSeconds:0,vehicleSeconds:0,cycles:0,stops:{}}),stopStats=stats.stops[bus.cell]||(stats.stops[bus.cell]={boarded:0,alighted:0,maxWaiting:0});
      stopStats.maxWaiting=Math.max(stopStats.maxWaiting,this.busStopDemand(bus.cell,line.id));
      const leaving = bus.passengers.filter(passenger => this.neighbors(passenger.goal).includes(bus.cell));
      if (leaving.length) {
        bus.passengers = bus.passengers.filter(passenger => !leaving.includes(passenger));
        for (const passenger of leaving) this.finishBusPassenger(passenger);
        moved += leaving.length;stats.alighted+=leaving.length;stopStats.alighted+=leaving.length;
      }
      for (let hi = 0; hi < this.homes.length && bus.passengers.length < BUS_CAPACITY; hi++) {
        const home = this.homes[hi];
        if (!this.neighbors(home.cell).includes(bus.cell)) continue;
        while (bus.passengers.length < BUS_CAPACITY && this.queues[hi] > 0) {
          const goalIndex = this.busGoalFor(home, bus.routePosition, bus.lineId);
          if (goalIndex === null) break;
          this.queues[hi]--;
          const commuteStarted = this.queueTimes[hi]?.shift() ?? this.elapsed;
          this.goalAssigned[goalIndex]++;
          this.departedByHome[hi]++;
          bus.passengers.push({ route: home.route, homeIndex: hi, goal: this.goals[goalIndex].cell, goalIndex, commuteStarted });
          moved++;stats.boarded++;stopStats.boarded++;
        }
      }
      if(bus.passengers.length>=BUS_CAPACITY)stats.rejectedFull+=this.busStopDemand(bus.cell,line.id);
      bus.dwell = moved / BUS_BOARDING_RATE;
      bus.needsStop = false;
    }
    spawnBuses() {
      this.buses = [];this.resetBusStats();
      for (const line of this.busLines) {
        if (!this.busLineOperational(line)) continue;
        const route = this.busOperatingRoute(line);
        if (route.length < 3) continue;
        for (let i = 0; i < line.count; i++) {
          const cell = route[0], heading = route[1] - cell;
          this.buses.push({ id: `${line.id}-bus-${i + 1}`, lineId: line.id, type: 'bus', routePosition: 0, cell, next: null, heading, cellHeading: heading, active:i===0, launchAt:i*line.headway,
            lane: 0, cellLane: 0, cellSlot: 1, progress: 0, blocked: 0, dwell: 0, needsStop: true, passengers: [] });
        }
      }
    }
    stepBus(bus, dt) {
      const line = this.busLine(bus.lineId), route = this.busOperatingRoute(line);
      if (route.length < 3) return;
      if(!bus.active){if(this.elapsed+1e-9<bus.launchAt||this.occupants(route[0],bus).length)return;bus.active=true;bus.cell=route[0];bus.routePosition=0;bus.heading=route[1]-route[0];bus.cellHeading=bus.heading;bus.needsStop=true;}
      const stats=line.stats;if(stats){stats.passengerSeconds+=bus.passengers.length*dt;stats.vehicleSeconds+=dt;}
      if (bus.needsStop) this.serviceBusStop(bus);
      if (bus.dwell > 0) { bus.dwell = Math.max(0, bus.dwell - dt); return; }
      const segments = route.length - 1;
      if (bus.next === null) {
        const nextPosition = bus.routePosition + 1, nextRoad = route[nextPosition];
        const routeAt = offset => {
          const position = nextPosition + offset;
          return position <= segments ? route[position] : route[1 + (position - segments - 1) % segments];
        };
        const heading = nextRoad - bus.cell;
        const internal = !this.signals.has(bus.cell) && bus.cellSlot === 0;
        const target = internal ? bus.cell : nextRoad;
        const slot = internal || this.signals.has(target) ? 1 : 0;
        const followingPosition = nextPosition >= segments ? 1 : nextPosition + 1;
        const exitHeading = route[followingPosition] - nextRoad;
        const junction = internal ? nextRoad : routeAt(1), junctionExit = internal ? routeAt(1) : routeAt(2);
        const turn = this.signals.has(junction) ? this.movement(junction - target, junctionExit - junction).turn : null;
        const preferred = turn ? this.turnLane(target, turn) : bus.cellLane || 0;
        const lane = this.laneFor(target, heading, bus, slot, exitHeading, preferred, turn !== null);
        if (lane < 0 || !internal && !this.canEnter(target, heading, exitHeading)) { bus.blocked += dt; return; }
        if (!internal && this.signals.has(target)) {
          const afterTarget = route[followingPosition];
          const afterExit = followingPosition >= segments ? route[1] - afterTarget : route[followingPosition + 1] - afterTarget;
          if (this.laneFor(afterTarget, exitHeading, bus, 0, afterExit) < 0) { bus.blocked += dt; return; }
        }
        bus.next = target;
        bus.nextSlot = slot;
        bus.nextMovement = this.signals.has(target) ? { ...this.movement(heading, exitHeading), exitCell: route[followingPosition] } : null;
        bus.heading = heading;
        bus.lane = lane;
        bus.blocked = 0;
        bus.advancingRoute = !internal;
        bus.distance = internal ? .5 : this.signals.has(bus.cell) || this.signals.has(target) ? .75 : .5;
      }
      const speeds = [bus.cell,bus.next].filter(n => this.roads.has(n)).map(n => this.roadType(n).speed);
      const yielding = [bus.cell,bus.next].some(n => this.signals.has(n) && !this.signals.get(n).enabled);
      bus.progress += dt * Math.min(...speeds) * BUS_SPEED_MULTIPLIER * (yielding ? .35 : 1) / (bus.distance || 1);
      if (bus.progress < 1) return;
      bus.cell = bus.next;
      bus.cellHeading = bus.heading;
      bus.cellLane = bus.lane;
      bus.cellSlot = bus.nextSlot ?? 0;
      bus.cellMovement = bus.nextMovement;
      bus.nextMovement = null;
      bus.next = null;
      bus.progress = 0;
      if (bus.advancingRoute) {
        bus.routePosition++;
        if (bus.routePosition >= segments) {bus.routePosition = 0;if(line.stats)line.stats.cycles++;}
        bus.needsStop = true;
      }
    }
    }
    const descriptors = Object.getOwnPropertyDescriptors(BusMethods.prototype);
    delete descriptors.constructor;
    Object.defineProperties(City.prototype, descriptors);
  };
});
