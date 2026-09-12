# PERF-3：无障碍网格既不可达又昂贵

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P1
- 状态：⬜ 待实施

- **现象**：`buildAccessibleMap()` 为每格创建一个 `<button role="gridcell">`（最大 64×64 = 4096 个），但 `updateAccessibleMap()` 每次都把所有单元格设为 `tabIndex = -1`，因此没有任何入口可以 Tab 进入；同时 `role="grid"` 的直接子元素全是 `gridcell`，缺少 `role="row"`，ARIA 结构无效。
  另外 `updateAccessibleMap()` 的签名包含 `Math.floor(city.elapsed*2)`，即**每 0.5 s 重写全部 `aria-label`**；`accessibleCellLabel()` 内部对道路格调用 `city.load(cell)`（O(V)）并扫描 `planningHints`（O(格数 × 提示数)）。
- **证据**：`game.js:224-227`（创建 `role="grid"`/`gridcell`）、`game.js:229-232`（全部 `tabIndex=-1` 与全量标签写入）、`game.js:966`（每帧调用）。网格容器见 `index.html:31`。
- **建议**：
  1. 改为 roving tabindex（只有当前格 `tabIndex=0`，方向键在格间移动并同步画布光标），补齐 `role="row"`/`aria-rowindex`/`aria-colindex`。
  2. 只在「选中格 ± 视口范围」（或视口内可见格）更新标签，并把 `elapsed` 从签名里去掉（改为按事件更新）。
  3. 如果保留「整格朗读」而无法访问，不如改为单个 `aria-live` 文本区播报当前格，删除 4096 个按钮。
- **验收**：`tests/ui-smoke.cjs` 增加「Tab 可进入网格、方向键可移动、`aria-rowindex` 递增」断言；性能上断言 0.5 s 内不重写全部格标签（可 stub 计数）。
