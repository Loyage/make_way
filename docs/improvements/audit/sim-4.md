# SIM-4：公交缺少运营成本与专用道

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P2
- 状态：⬜ 待实施

- **现象**：公交只有一次性建设费 `BUS_COST = 6`（`core.js`），没有按天/按圈的运营成本，也没有收入分成；`bus-only-street` 关卡用「汽车禁行」实现强制通勤，但核心没有「公交专用道」（只有整格 policy）。
- **建议**：多日任务中为每辆公交增加每日维护费（或把公交载客量计入收入权重），让「修路 vs 增开公交」成为真实取舍；`setRoadPolicy` 增加 `bus-only`（公交可走、汽车绕行），可复用现有 `roadTravelCost` 的 `avoid` 逻辑。
- **验收**：`tests/bus.test.js` 增加成本/预算与 `bus-only` 选路用例；`tests/levels.test.js` 重算公交关星级。
