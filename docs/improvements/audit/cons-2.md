# CONS-2：README 快捷键与真实按键不一致

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：未标优先级
- 状态：✅ 已完成（以代码和主索引为准）

- **现象**：实际界面是 `1 观察 / 2 选择 / 3 拖拽 / 4 剪刀 / 5 公交线`（`src/game/index.html` 工具栏、`src/game/game.js:1349`、`src/game/manual.html` 全部一致）。
  `README.md` 却写成「选择模式（1）…拖拽模式（2）…剪刀模式（3）…公交线模式（4）」以及快捷键表 `` `1`/`2`/`3`/`4` → 选择 / 拖拽 / 剪刀 / 公交线 ``。
- **证据**：`README.md:128-131`、`README.md:146` 对比 `src/game/index.html:31` 与 `manual.html` 的 MODE 01–05 标题。
- **建议**：按 `manual.html` 校正 README 的操作章节与快捷键表；并在 `tests/` 里加一条静态断言（读取 `index.html` 的 `kbd` 文案与 README 表格比对），避免再次漂移。
- **现状**：工作区已按上述方案修正（`README.md:98`、`README.md:128-132`、`README.md:146`），并新增 `tests/docs.test.js` 做「UI / 帮助对话框 / 指南 / README / 键盘处理」五方一致性断言，同时扩展了 `tests/browser-smoke.cjs` 的 `1`–`5` 按键断言。本条可关闭；后续只需保证该测试进入 CI（见 ENG-1/ENG-2）。
