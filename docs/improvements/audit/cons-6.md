# CONS-6：观察模式下按空格给出误导提示

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P2
- 状态：⬜ 待实施

- **现象**：`src/game/game.js:1391` 在非规划模式下按空格会 `selectSingleCell()` 并提示「请使用下方区域操作区」，但 `setTool()` 只在 `select` 模式显示 `#road-inspector`（`game.js:280`），观察模式下面板是隐藏的。
- **建议**：观察模式下忽略空格，或提示「按 2 切换到选择模式后可查看该格信息」，并顺带 `setTool('select')`。
