/* Shared, DOM-free simulation. Works offline in browsers and in Node tests. */
(function (root) {
  'use strict';
  const WIDTH = 16, HEIGHT = 12, BUDGET = 64, DURATION = 120, TARGET = 35;
  const key = (x, y) => y * WIDTH + x;
  const point = n => ({ x: n % WIDTH, y: Math.floor(n / WIDTH) });
  const LEVELS = typeof module !== 'undefined' && module.exports ? require('./levels.js') : root.TrafficLevels;
  // Legacy constants describe the original riverside scenario.
  const ROUTES = LEVELS.find(level => level.id === 'riverside').routes;
  function neighbors(n) {
    const { x, y } = point(n), out = [];
    if (x > 0) out.push(n - 1);
    if (x < WIDTH - 1) out.push(n + 1);
    if (y > 0) out.push(n - WIDTH);
    if (y < HEIGHT - 1) out.push(n + WIDTH);
    return out;
  }
  function findPath(roads, start, goal) {
    if (start === goal) return [start];
    const queue = [start], prev = new Map([[start, null]]);
    for (let i = 0; i < queue.length; i++) {
      for (const n of neighbors(queue[i])) {
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
  class City {
    constructor(levelId = 'riverside') {
      this.level = LEVELS.find(level => level.id === levelId);
      if (!this.level) throw new RangeError(`Unknown level: ${levelId}`);
      this.routes = this.level.routes;
      this.water = new Set(this.level.water);
      this.bridges = new Set(this.level.bridges);
      this.roads = new Set(this.bridges);
      this.trees = new Set(this.level.trees);
      this.buildings = new Set(this.routes.flatMap(r => [r.home, r.goal]));
      this.queues = this.routes.map(() => 0);
      this.spawnTimers = this.routes.map((_, i) => i * 0.8);
      this.cars = [];
      this.elapsed = 0;
      this.delivered = 0;
      this.byRoute = this.routes.map(() => 0);
      this.state = 'planning';
      this.nextId = 1;
      this.paths = [];
      this.refreshPaths();
    }
    get remaining() { return this.level.budget - (this.roads.size - this.bridges.size); }
    refreshPaths() { this.paths = this.routes.map(r => findPath(this.roads, r.home, r.goal)); }
    edit(n, erase = false) {
      if (!Number.isInteger(n) || n < 0 || n >= WIDTH * HEIGHT || this.state === 'won' || this.state === 'lost') return '';
      if (this.bridges.has(n)) return '桥梁是固定道路，无需修建，也不能拆除';
      if (this.buildings.has(n)) return '把道路修到建筑旁边，即可连接';
      if (erase) {
        if (!this.roads.has(n)) return '';
        if (this.cars.some(c => c.cell === n || c.next === n)) return '这里有车辆，请等车辆通过后再拆除';
        this.roads.delete(n);
      } else {
        if (this.roads.has(n)) return '';
        if (this.water.has(n)) return '河流上不能修路，请连接现有桥梁';
        if (this.trees.has(n)) return '保留这片绿地吧，试着绕行';
        if (this.remaining <= 0) return '道路额度已用完，拆除闲置道路可以返还';
        this.roads.add(n);
      }
      this.refreshPaths();
      return '';
    }
    toggle() {
      if (this.state === 'planning' || this.state === 'paused') this.state = 'running';
      else if (this.state === 'running') this.state = 'paused';
    }
    available(cell, heading, self) {
      return !this.cars.some(c => c !== self && c.heading === heading && (c.cell === cell || c.next === cell));
    }
    step(dt) {
      if (this.state !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
      dt = Math.min(dt, 0.1, this.level.duration - this.elapsed);
      this.elapsed += dt;
      this.routes.forEach((r, i) => {
        this.spawnTimers[i] -= dt;
        if (this.spawnTimers[i] <= 0) { this.queues[i]++; this.spawnTimers[i] += this.level.spawnInterval; }
        const path = this.paths[i];
        if (this.queues[i] && path) {
          const heading = path[1] - path[0];
          if (this.available(r.home, heading) && this.available(path[1], heading)) {
            this.cars.push({ id: this.nextId++, route: i, cell: r.home, next: null, heading, progress: 0, blocked: 0 });
            this.queues[i]--;
          }
        }
      });
      for (const car of this.cars) {
        if (car.done) continue;
        if (car.next === null) {
          const path = findPath(this.roads, car.cell, this.routes[car.route].goal);
          if (!path || path.length < 2) { car.blocked += dt; continue; }
          const heading = path[1] - car.cell;
          if (!this.available(path[1], heading, car)) { car.blocked += dt; continue; }
          car.next = path[1];
          car.heading = heading;
          car.blocked = 0;
        }
        car.progress += dt * 2.8;
        if (car.progress >= 1) {
          car.cell = car.next;
          car.next = null;
          car.progress = 0;
          if (car.cell === this.routes[car.route].goal) {
            car.done = true;
            this.delivered++;
            this.byRoute[car.route]++;
          }
        }
      }
      this.cars = this.cars.filter(c => !c.done);
      if (this.delivered >= this.level.target) this.state = 'won';
      else if (this.elapsed >= this.level.duration) this.state = 'lost';
    }
  }
  const api = { City, LEVELS, WIDTH, HEIGHT, BUDGET, DURATION, TARGET, ROUTES, key, point, neighbors, findPath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
