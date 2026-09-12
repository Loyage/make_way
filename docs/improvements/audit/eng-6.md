# ENG-6：细节打磨

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P2
- 状态：⬜ 待实施

- 仓库没有 `LICENSE`（README 也未说明授权），对外分享前应补一份。
- 服务端 CSP 的 `style-src 'self' 'unsafe-inline'` 可以收窄为 `style-src 'self'; style-src-attr 'unsafe-inline'`（页面没有内联 `<style>`，只有 JS 设置的 style 属性），同时 `tests/server.test.js` 增加断言。
- `Cache-Control: no-cache` + ETag 会让每次刷新都发约 50 次条件请求；与 PERF-5 的压缩/懒加载一起优化效果更好。
- 游戏服务与管理员服务各自维护一份 `SECURITY_HEADERS`/资源白名单，容易漂移；建议抽出共享模块并加一致性测试。
