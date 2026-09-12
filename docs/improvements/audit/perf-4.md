# PERF-4：每帧无条件更新界面

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P1
- 状态：⬜ 待实施

- **现象**：`frame()` 每帧 `updateUI()` + `draw()`，即使规划中/暂停/无变化；`updateUI()` 里还有：
  - `liveSatisfactionReport()`：把 `city.queueTimes`（每产生一位居民追加一次）和 `city.commuteTimes`（每抵达一位追加一次）**全量**拼进新数组（`game.js:860-868`）；
  - `updateInspector()`（`game.js:475`）大量 `textContent` 写入与字符串拼接；
  - `updateBusLineInspector()`（`game.js:394-397`）每帧 `replaceChildren()` 并按线路重建 DOM；
  - `renderCampaignProgress()`、`updatePlanningHints()` 有签名缓存（较好），但 `updateAccessibleMap()` 见 PERF-3。
- **影响**：桌面端持续的 60 fps DOM 写入 + GC 压力；移动端耗电与发热；大人口关卡下满意度扫描随人口线性增长。
- **建议**：
  1. 引入脏标记：设计/状态/统计变化时才刷新文本类 HUD，其余时间 5–10 Hz 节流；画布保持 60 fps，但空闲（无动画、无车辆移动）时跳过重绘。
  2. `liveSatisfactionReport()` 改为增量维护直方图（分档计数 + 总时长），避免每帧 O(人口) 扫描。
  3. `updateBusLineInspector()` 的 DOM 只在选择格/线路数据变化时重建。
- **验收**：新增按需运行的 `tests/ui-timing.js`，统计规划状态下 3 s 内的 DOM 写入次数/帧时间；不并入日常冒烟，配合 `prefers-reduced-motion` 与后台标签页专项执行。
