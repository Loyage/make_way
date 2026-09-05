/* Handcrafted scenarios. Coordinates share the 16 × 12 city grid. */
(function (root) {
  'use strict';
  const key = (x, y) => y * 16 + x;
  const cells = points => points.map(([x, y]) => key(x, y));
  const river = columns => columns.flatMap(x => Array.from({ length: 12 }, (_, y) => key(x, y)));
  const colors = [
    ['#638d69', '#dae6cb', '松林住宅', '工坊'],
    ['#d19157', '#f2dfbf', '日落住宅', '市场'],
    ['#9582b4', '#e7dff0', '丁香住宅', '书店'],
    ['#578fa4', '#d3e7ed', '海风住宅', '车站'],
    ['#bf768b', '#efd9e1', '玫瑰住宅', '花园']
  ];
  function routes(pairs) {
    return pairs.map(([home, goal], i) => {
      const [color, light, name, label] = colors[i];
      return { name: `${name} → ${label}`, color, light, home: key(...home), goal: key(...goal), label };
    });
  }
  const LEVELS = [
    {
      id: 'neighborhood', name: '晨光街区', english: 'FIRST CONNECTION', difficulty: '入门',
      title: '从家门口的第一条路开始。',
      description: '没有河流阻隔，先学会连接两组建筑。短而直接的道路，就是好规划。',
      tip: '从住宅出发，沿空地画到同色目的地旁边。',
      budget: 36, duration: 90, target: 22, spawnInterval: 3.8,
      water: [], bridges: [],
      trees: cells([[1,1],[2,1],[7,1],[8,1],[7,5],[8,5],[1,9],[14,10],[13,10]]),
      routes: routes([[[2,3],[11,3]], [[12,8],[4,8]]])
    },
    {
      id: 'riverside', name: '河畔新城', english: 'RIVERSIDE', difficulty: '初阶',
      title: '两岸之间，畅行无阻。',
      description: '跨过河流，把两岸的生活连接起来。两座桥可以帮助你分散车流。',
      tip: '先连通一组，再借助两座桥慢慢扩展。',
      budget: 64, duration: 120, target: 35, spawnInterval: 3.2,
      water: river([7,8]), bridges: cells([[7,3],[8,3],[7,8],[8,8]]),
      trees: cells([[1,5],[2,5],[4,1],[5,5],[5,6],[10,1],[11,1],[14,5],[14,6],[10,10],[11,10],[1,10]]),
      routes: routes([[[2,2],[12,3]], [[13,9],[3,8]], [[3,10],[12,6]]])
    },
    {
      id: 'woodland', name: '林间环城', english: 'WOODLAND LOOP', difficulty: '进阶',
      title: '为生活让路，也为绿意留白。',
      description: '中央绿地不能建设。四组出行围绕树林展开，共享道路能节省额度，也可能带来排队。',
      tip: '沿树林外围组织交通，避免一味穿越城市中心。',
      budget: 46, duration: 110, target: 60, spawnInterval: 3,
      water: [], bridges: [],
      trees: cells([[6,4],[7,4],[8,4],[9,4],[6,5],[7,5],[8,5],[9,5],[6,6],[7,6],[8,6],[9,6],[6,7],[7,7],[8,7],[9,7],[1,1],[14,10]]),
      routes: routes([[[2,2],[12,2]], [[13,9],[3,9]], [[2,7],[12,5]], [[13,7],[4,4]]])
    },
    {
      id: 'islands', name: '双河群岛', english: 'TWIN RIVERS', difficulty: '挑战',
      title: '三片城区，四座桥，一张路网。',
      description: '两条河把城市分成三片区域，桥梁错位分布。规划跨河走廊，让四组出行各得其所。',
      tip: '上方桥梁错开一格；下方两座桥可以连成直达通道。',
      budget: 48, duration: 100, target: 75, spawnInterval: 2.7,
      water: river([5,10]), bridges: cells([[5,3],[5,8],[10,4],[10,8]]),
      trees: cells([[1,5],[2,5],[7,1],[8,1],[7,6],[8,6],[13,1],[14,6],[6,10],[12,10]]),
      routes: routes([[[2,2],[13,3]], [[13,9],[2,8]], [[7,9],[13,6]], [[8,2],[2,6]]])
    },
    {
      id: 'rush-hour', name: '都会早高峰', english: 'RUSH HOUR', difficulty: '专家',
      title: '当整座城市同时出发。',
      description: '五组出行，每两秒产生一辆新车。用有限道路构建多条通道，迎接密集的早高峰。',
      tip: '东西两岸都需要纵向道路，别让所有车辆挤在同一座桥上。',
      budget: 52, duration: 100, target: 110, spawnInterval: 2,
      water: river([7,8]), bridges: cells([[7,2],[8,2],[7,6],[8,6],[7,9],[8,9]]),
      trees: cells([[4,1],[5,1],[11,1],[1,5],[5,5],[10,4],[14,5],[5,10],[10,10]]),
      routes: routes([[[2,2],[13,2]], [[13,9],[2,9]], [[3,10],[12,6]], [[12,4],[3,4]], [[2,6],[13,7]]])
    }
  ];
  // Keep scenario data immutable; each City owns its mutable roads and demand.
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  freeze(LEVELS);
  if (typeof module !== 'undefined' && module.exports) module.exports = LEVELS;
  else root.TrafficLevels = LEVELS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
