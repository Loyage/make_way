# PERF-1：`occupants()` 是 O(车辆数)，并把 `step()` 与寻路拖成 O(V²)

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P0
- 状态：⬜ 待实施

- **现象**：`City.occupants(n, self)` 每次都 `[...this.cars, ...this.buses].filter(...)`，即「新建两个数组 + 全量扫描」。它被 `laneFor()`、`junctionAvailable()`、`load()`、`exitLocked()`、编辑保护等高频路径调用；`step()` 每辆车每步至少调用 1–3 次，`dynamicRoadTravelCost()`（改道与检查器寻路）也依赖 `load()`/`occupants()`。
- **证据**：
  - `src/shared/core.js:489`（`occupants`）、`496-497`（`junctionAvailable`）、`501/510`（`laneFor`/`load`）、`299`（动态成本）。
  - 调用计数（16×12、10 条走廊、90 辆车）：**每步 `occupants` 241 次、`reservations` 274 次**（后者每次又为每辆车分配对象）。
  - 规模实测（64×64、N 条 62 格走廊、快速路等级）：

    | 走廊数 | 在途车辆 | 每步耗时 |
    | ---: | ---: | ---: |
    | 15 | 765 | **100 ms** |
    | 30 | 1530 | **343 ms** |
    | 60 | 3060 | **1345 ms** |

    车辆数 ×4 → 耗时 ×13.4，呈平方级增长。以 20 步/秒（1× 速度）计，765 辆车时已经需要 2 s 机时/模拟秒，3060 辆车时约 27 s/模拟秒（标签页直接失去响应）。
- **建议**：
  1. 增加按格占用索引：`this.occupancy = Map<cell, Set<vehicle>>`（另按 `heading` 分桶，或对每格缓存 `{counts, slots}`），车辆进入/离开格时增量维护；`occupants/load/laneFor/junctionAvailable/exitLocked` 改为查索引，避免展开整表。
  2. `reservations(vehicle)` 改为复用固定对象（或在索引里直接保存 slot 描述），消除每步数万次短命对象。
  3. 顺带把 `load()` 的「最忙方向」计算改为索引内维护的每方向计数。
- **验收**：新增 `tests/performance.test.js`，先用当前实现记录基线（765/1530/3060 辆车的每步耗时），修复后阈值设为基线的 1/5 以内；同时断言 `step()` 中 `occupants` 调用不再随车辆数增长（可用计数桩）。
