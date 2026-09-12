# ENG-3：`game.js`（1457 行）没有单元测试

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P1
- 状态：⬜ 待实施

- **现象**：核心、关卡、公交、服务器都有独立测试；玩家界面唯一的纯逻辑大文件 `game.js` 只有浏览器冒烟覆盖。其中不少是纯函数/纯状态机，可无 DOM 测试：`paint()` 的斜拖插值、`operationRoads/operationSummary`、`roadSegment`、`designHistory` 记录与恢复、`campaignConditionText`、`starTargetsFor`、`focusInitialView`/`viewBounds` 的钳制。
- **建议**：按现有模块化风格再拆出 `game-drafts.js`（拖拽/选区/历史）与 `game-hints.js`（提示与文案），同时给它们加 `tests/*.test.js`；`game.js` 只保留事件绑定与编排。
- **验收**：新增至少 15 条无 DOM 单测覆盖上述函数；`node --check` 与浏览器冒烟仍通过。
