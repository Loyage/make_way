# ENG-2：浏览器冒烟测试长期处于「可选且易失效」状态

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P1
- 状态：⬜ 待实施

- **现象**：`tests/browser-smoke.cjs`、`ui-smoke.cjs`、`admin-browser-smoke.cjs` 需要手动启动服务和本机 Chromium CDP，不在 `node --test tests/*.test.js` 内，因此常年不执行（例如 `ui-smoke.cjs:95` 的 44 px 触控断言、`browser-smoke.cjs:23` 的 favicon 容忍逻辑都不会被验证）。
- **建议**：把三个脚本纳入 CI 的可选 job（`nix shell nixpkgs#chromium` 或环境变量指定浏览器），或在 `tests/` 增加 `npm`-free 的自检脚本 `tests/browser-smoke.sh` 负责启动/清理；至少让「最近一次执行结果」可见。
- **验收**：CI 中出现浏览器 job 的执行日志（允许在无 Chromium 环境下 skip 并显式报告）。
