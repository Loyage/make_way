# PERF-2：选中住宅时每帧执行两次完整寻路

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P0
- 状态：⬜ 待实施

- **现象**：
  - `frame()` 每帧调用 `updateUI()` 与 `draw()`（`game.js:1397-1411`）。
  - `draw()` → `selectedHomeTravelInfo()` → `city.homeTravelInfo()`（`game.js:741/353-356`）。
  - `updateUI()` → `updateInspector()` → `city.homeTravelInfo()`（`game.js:890/475/525`）。
  - `homeTravelInfo()` 会跑 `bestGoalPath()`（Dijkstra，运营中还使用动态拥堵成本）。
- **实测**：64×64 地图、760 辆车时 **`homeTravelInfo` ≈ 6.3–8.8 ms/次**（走廊仅 62 格，成本主要来自对每格调用 `load()`/`occupants()`）。两次/帧 ≈ 12–18 ms，仅此一项就吃满 60 fps 预算。
- **建议**：
  1. 按「设计指纹 + 关卡状态 + 0.25 s 时间片」缓存 `homeTravelInfo`，`draw()` 直接复用检查器结果。
  2. 与 PERF-1 一起修：缓存修复后同样的寻路会便宜一个数量级。
  3. 检查器文本更新降频到 5–10 Hz（见 PERF-4）。
- **验收**：`tests/canvas.test.js` / 新增 UI 单测断言「同一 tick 内 `homeTravelInfo` 只计算一次」；浏览器冒烟测试在运营中选中住宅时不再出现掉帧断言（可加 `performance.now()` 采样）。
