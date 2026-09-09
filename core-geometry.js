(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TrafficGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const WIDTH = 16, HEIGHT = 12, MIN_MAP_SIZE = 8, MAX_MAP_SIZE = 64;
  const key = (x, y, width = WIDTH) => y * width + x;
  const point = (n, width = WIDTH) => ({ x: n % width, y: Math.floor(n / width) });
  function neighbors(n, width = WIDTH, height = HEIGHT) {
    const { x, y } = point(n, width), out = [];
    if (x > 0) out.push(n - 1);
    if (x < width - 1) out.push(n + 1);
    if (y > 0) out.push(n - width);
    if (y < height - 1) out.push(n + width);
    return out;
  }
  function findPath(roads, start, goal, edges = null, width = WIDTH, height = HEIGHT) {
    if (start === goal) return [start];
    const queue = [start], prev = new Map([[start, null]]);
    for (let i = 0; i < queue.length; i++) {
      for (const n of edges ? (edges.get(queue[i]) || []) : neighbors(queue[i], width, height)) {
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
  return { WIDTH, HEIGHT, MIN_MAP_SIZE, MAX_MAP_SIZE, key, point, neighbors, findPath };
});
