# CONS-3：README 宣称的「另存为配置 / 覆盖默认配置」在面板没有入口

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P1
- 状态：⬜ 待实施

- **现象**：`README.md:51` 描述管理员可「另存为配置」（写入 `level-presets/`）与「覆盖默认配置」（重建 `levels/` 并更新 `built-in-levels.json`）。服务端确实实现了 `PUT /api/presets/<name>` 与 `PUT /api/default`（`src/server/admin-server.js:278-302`、`303-315`），并有测试（`tests/admin.test.js:213`）；但 `src/admin/admin-panel.html` 里没有任何对应按钮，`src/admin/admin.js` 也从不请求这两个接口。
- **影响**：文档承诺了不可用功能；两段已测试的服务端代码没有使用方（除测试外为死路径）。
- **建议**：二选一——(a) 在控制台补「另存为配置 / 载入配置 / 覆盖默认配置」入口（含确认与重名校验提示）；(b) 若有意只保留 API/CLI，则改写 README 与管理员手册，标注为「HTTP 接口，需自行调用」。
- **验收**：面板按钮或文档二选一后一致；若补 UI，`tests/admin-browser-smoke.cjs` 增加一次预设往返。
