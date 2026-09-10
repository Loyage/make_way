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
  function findWeightedPath(roads, start, goal, edges = null, cost = () => 1, width = WIDTH, height = HEIGHT) {
    if (start === goal) return [start];
    const distances = new Map([[start, 0]]), previous = new Map(), heap = [[0,start]];
    const push = item => { heap.push(item);let index=heap.length-1;while(index){const parent=Math.floor((index-1)/2),a=heap[parent],b=heap[index];if(a[0]<b[0]||a[0]===b[0]&&a[1]<=b[1])break;[heap[parent],heap[index]]=[b,a];index=parent;} };
    const pop = () => {const first=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let index=0;while(true){let child=index*2+1;if(child>=heap.length)break;if(child+1<heap.length&&(heap[child+1][0]<heap[child][0]||heap[child+1][0]===heap[child][0]&&heap[child+1][1]<heap[child][1]))child++;const a=heap[index],b=heap[child];if(a[0]<b[0]||a[0]===b[0]&&a[1]<=b[1])break;[heap[index],heap[child]]=[b,a];index=child;}}return first;};
    while (heap.length) {
      const [best,current] = pop();
      if (best > (distances.get(current) ?? Infinity) + 1e-9) continue;
      if (current === goal) break;
      const links = edges ? (edges.get(current) || []) : neighbors(current, width, height);
      for (const next of links) {
        if (next !== goal && !roads.has(next)) continue;
        const step = cost(current, next);
        if (!Number.isFinite(step) || step < 0) continue;
        const candidate = best + step;
        if (candidate + 1e-9 < (distances.get(next) ?? Infinity)) { distances.set(next, candidate); previous.set(next, current); push([candidate,next]); }
      }
    }
    if (!distances.has(goal)) return null;
    const path = [goal];
    while (path[0] !== start) path.unshift(previous.get(path[0]));
    return path;
  }
  return { WIDTH, HEIGHT, MIN_MAP_SIZE, MAX_MAP_SIZE, key, point, neighbors, findPath, findWeightedPath };
});
