# CONS-4：「人工试玩」门禁只在前端

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P1
- 状态：⬜ 待实施

- **现象**：`src/admin/admin.js` 用浏览器内存里的 `verifiedLevels`（关卡指纹）阻止发布，`admin-manual.html` 也声明「只在完整校验和人工通关门禁均通过后写盘」。但 `PUT /api/levels`（`src/server/admin-server.js:261-275`）只做 `validateLevels` + `validateReferenceChains`，不校验任何试玩凭证。
- **影响**：门禁可通过直接调用 API 绕过；手册与实现不一致（也会误导「发布内容一定被人工通关过」的假设）。
- **建议**：服务端记录「已试玩验证」的 `levelId + 指纹`（内存即可，重启失效），`PUT /api/levels` 拒绝未验证关卡；或明确降级为「前端提示 + 服务端结构校验」并同步手册措辞。注意与 `CONS-1` 的发布自检一起设计。
- **验收**：`tests/admin.test.js` 增加「未带试玩凭证的 PUT 被拒绝」用例（若选方案 A）。
