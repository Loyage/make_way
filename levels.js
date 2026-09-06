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
  // Measured straight-road throughput at step(0.05): about 2 / 5 / 6.67 people/s.
  // Demand runs for long enough that a low-grade road cannot hide its backlog.
  // Each route now lists one or many origins (homes) and destinations (goals);
  // every home carries its own output (rate/passengers) and every goal may cap its input.
  const home = (x1, y1, rate, seconds) => ({ cell: key(x1, y1), rate, passengers: rate * seconds });
  const goal = (x1, y1, label, input) => ({ cell: key(x1, y1), label, ...(input == null ? {} : { input }) });
  function route(colorIndex, name, homes, goals) {
    const [color, light, homeName, goalLabel] = colors[colorIndex];
    return { name: name || `${homeName} → ${goalLabel}`, color, light, homes, goals };
  }
  function routes(pairs, rates, seconds) {
    return pairs.map(([a, b], i) => route(i, null, [home(...a, rates[i], seconds)], [goal(...b, colors[i][3])]));
  }
  const line = (x1,y1,x2,y2,grade=0) => {
    const out=[];let x=x1,y=y1;
    while(x!==x2 || y!==y2) {
      const a=key(x,y);if(x!==x2)x+=Math.sign(x2-x);else y+=Math.sign(y2-y);
      out.push([a,key(x,y),grade]);
    }
    return out;
  };
  const features = (grade, load, cut, inspect, signals) => ({ grade, load, cut, inspect, signals });
  const LEVELS = [
    {
      id: 'neighborhood', name: '晨光街区', english: 'FIRST CONNECTION', difficulty: '教学一',
      title: '从家门口的第一条路开始。',
      description: '先只使用支路。拖动连接两组同色建筑，学习道路只按笔迹方向相连。',
      tip: '从住宅开始拖动，直到同色目的地；单击不会修路。',
      lesson: '基础连接', features: features(false, false, false, false, false),
      budget: 36, duration: 90, target: 100,
      water: [], bridges: [],
      trees: cells([[1,1],[2,1],[7,1],[8,1],[7,5],[8,5],[1,9],[14,10],[13,10]]),
      routes: routes([[[2,3],[11,3]], [[12,8],[4,8]]], [1,1], 60)
    },
    {
      id: 'demolition-school', name: '街区改造', english: 'REBUILD THE ROAD', difficulty: '教学二',
      title: '拆掉绕路，把预算还给捷径。',
      description: '旧支路绕了大半个街区，预算已经用完。拆除绕行段返还预算，再沿住宅和工坊之间修一条直路。',
      tip: '选择拆除工具（2）拖过旧路，或按住右键拆路；再切回修建（1），从住宅拖到工坊。',
      lesson: '拆除与重建', features: features(false, false, false, false, false),
      budget: 27, duration: 60, target: 54,
      water: [], bridges: [], trees: [],
      routes: routes([[[2,2],[2,8]]], [1], 55),
      initialEdges: [...line(2,2,13,2),...line(13,2,13,8),...line(13,8,2,8)]
    },
    {
      id: 'avenue-school', name: '高层出行', english: 'ROAD GRADES', difficulty: '教学三',
      title: '房子越大，道路越要跟上。',
      description: '小房子每秒 1 人、大房子 4 人、高层 6 人。三条支路已经接通：小房子可用支路，大房子适合干道，高层需要快速路或有效分流。',
      tip: '选择道路等级，涂过已有道路只支付差价。查看负荷与排队；只升级中间几格，出入口仍会成为瓶颈。',
      lesson: '客流与道路等级', features: features(true, true, false, false, false),
      budget: 60, duration: 65, target: 580,
      water: [], bridges: [], trees: [],
      routes: routes([[[2,2],[13,2]],[[2,5],[13,5]],[[2,8],[13,8]]], [1,4,6], 55),
      initialEdges: [...line(2,2,13,2),...line(2,5,13,5),...line(2,8,13,8)]
    },
    {
      id: 'woodland', name: '林间环城', english: 'FEED THE RING', difficulty: '教学四',
      title: '让支线汇入已建好的快速环路。',
      description: '树林外围已铺好完整快速环路。四组建筑都还没有接通，把客流引到环路上，不必重建主路。汇入口默认减速礼让。',
      tip: '用短支线把同色建筑接入环路，接到快速路时选择快速路等级以免降级；用路况检查汇入口，剪刀可断开多余连接。',
      lesson: '环路集散', features: features(true, true, true, true, true),
      budget: 108, duration: 120, target: 200,
      water: [], bridges: [],
      trees: cells([[6,4],[7,4],[8,4],[9,4],[6,5],[7,5],[8,5],[9,5],[6,6],[7,6],[8,6],[9,6],[6,7],[7,7],[8,7],[9,7],[1,1],[14,10]]),
      routes: routes([[[2,2],[12,2]], [[13,9],[3,9]], [[2,7],[12,5]], [[13,7],[4,4]]], [1,1,1,1], 60),
      initialEdges: [...line(3,3,11,3,2),...line(11,3,11,8,2),...line(11,8,3,8,2),...line(3,8,3,3,2)]
    },
    {
      id: 'signal-school', name: '交叉调度', english: 'COORDINATE JUNCTIONS', difficulty: '教学五',
      title: '补齐交叉路网，把灯放在真正繁忙的路口。',
      description: '两条横向干道已铺好，纵向通道仍有缺口。四股车流交错，其中一股需要转弯；补路后检查多个路口，用红绿灯改善自动避让的瓶颈。',
      tip: '补齐两条纵向通道，接通所有同色建筑；先运行观察，再停止运营调整信号。不是每个路口都需要相同绿灯时长。',
      lesson: '交叉与信号灯', features: features(true, true, true, true, true),
      budget: 110, duration: 95, target: 220,
      water: [], bridges: [],
      trees: cells([[2,2],[13,2],[2,9],[13,9],[7,5],[8,5],[7,6],[8,6]]),
      routes: routes([[[1,4],[14,4]], [[14,7],[1,7]], [[5,1],[5,10]], [[10,10],[12,1]]], [1,1,1,1], 70),
      initialEdges: [...line(1,4,14,4,1),...line(14,7,1,7,1),...line(5,1,5,3,1),...line(10,10,10,8,1)]
    },
    {
      id: 'rush-hour', name: '都会早高峰', english: 'RUSH HOUR', difficulty: '综合挑战',
      title: '当整座城市同时出发。',
      description: '所有工具均已开放。用道路等级、分流、剪断与信号灯构建一张高效路网。',
      tip: '东西两岸都需要纵向道路，别让所有车辆挤在同一座桥上。高层出口要有足够车道，桥梁也可升级。',
      lesson: '综合规划', features: features(true, true, true, true, true),
      budget: 150, duration: 100, target: 660,
      water: river([7,8]), bridges: cells([[7,2],[8,2],[7,6],[8,6],[7,9],[8,9]]),
      trees: cells([[4,1],[5,1],[11,1],[1,5],[5,5],[10,4],[14,5],[5,10],[10,10]]),
      routes: routes([[[2,2],[13,2]], [[13,9],[2,9]], [[3,10],[12,6]], [[12,4],[3,4]], [[2,6],[13,7]]], [6,4,4,1,1], 55)
    }
  ];
  function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  freeze(LEVELS);
  if (typeof module !== 'undefined' && module.exports) module.exports = LEVELS;
  else root.TrafficLevels = LEVELS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
