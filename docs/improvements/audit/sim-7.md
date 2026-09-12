# SIM-7：存档无法导出、导入或分享

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P2
- 状态：⬜ 待实施

- **现象**：设计只存在浏览器 `localStorage`（`STORAGE_PREFIX`），没有导出文件/文本、导入、URL 分享。
- **建议**：增加「复制设计代码 / 粘贴导入」与可选的 `#design=...` 深链（hash 不会触发网络请求，注意 `default-src 'none'` 下仍可解析）；对管理员也有价值（收集玩家方案复现 bug）。
- **验收**：新增 `tests/design-share.test.js`（序列化 → 解析 → `loadDesign` 往返，含损坏输入拒绝）；手册同步。
