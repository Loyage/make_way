# CONS-5：`AGENTS.md` 引用了已删除的改进文档

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：未标优先级
- 状态：✅ 已完成（以代码和主索引为准）

- **现象**：`AGENTS.md:47` 要求「`GAME_IMPROVEMENT_DIRECTIONS.md` 的完成状态须与实际实现一致」，但该文件在历史中已被删除（`git log --diff-filter=D` 可见），当前仓库不存在。
- **建议**：把该条指引改为指向本文件（`dsim.md`），或恢复一份「已实现 / 待实现」状态表；两者取其一，避免新人按不存在的文件操作。
- **现状**：工作区已恢复 `GAME_IMPROVEMENT_DIRECTIONS.md`（含状态图例、已实现能力盘点与路线图）。**请注意**：该文件与本 `dsim.md` 有职责重叠，落地时需明确——建议 `GAME_IMPROVEMENT_DIRECTIONS.md` 记「状态」，`dsim.md` 记「证据与验收」，并在两处互相链接。
