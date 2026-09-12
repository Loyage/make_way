# ENG-5：关卡格式没有文档化 schema

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P2
- 状态：⬜ 待实施

- **现象**：关卡格式的事实规范是 `src/shared/level-validation.js`（398 行），没有 `docs/level-format.md`，也没有 JSON Schema；管理员手册只描述界面字段。
- **建议**：输出 `docs/level-format.md` + `levels.schema.json`（可由校验器手工同步），让编辑器提供补全/校验，也便于第三方贡献关卡。
- **验收**：新增测试断言「所有内置关卡满足 schema」（可用轻量校验脚本，避免引入依赖）。
