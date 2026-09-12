# CONS-7：死代码与遗留开关

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P2
- 状态：⬜ 待实施

- `src/shared/core.js:78`：`SIGNAL_ENTRIES` 定义后从未使用（真正使用的是每次传入 `width` 的 `signalEntries()`）。
- `core.js:146/995`：`deadlineMode` 只有测试在设置（`tests/traffic.test.js:10` 等），游戏运行路径从不使用。
- `src/game/game.js` `#load-design` 处理里 `if (city.state === 'running') city.toggle();` 位于 `state !== 'planning'` 提前返回之后，不可达。
- `src/admin/admin.js` 章节编辑连续三次 `prompt()`、删除用 `confirm()`，与游戏内自定义对话框风格不一致，移动端体验差。
- **建议**：清理死代码；把管理员章节编辑改为面板内表单/对话框。
