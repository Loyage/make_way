# PERF-5：启动拉取两套关卡清单，且无压缩

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P1
- 状态：⬜ 待实施

- **现象**：`loadActiveCatalog()` 先取 `built-in-levels.json` 及其 4 个章节、22 个关卡文件，再取 `levels.json` 与 `levels.local/` 的整套（重复内容）。实测 JSON 体积：内置 196 851 B + 覆盖 194 064 B ≈ **390 KB，约 50 个请求**；另加 JS/CSS 346 788 B。服务端没有任何压缩（`src/server/game-server.js` 未使用 `node:zlib`），并且把隐藏的「设计素材库」也一并下载。
- **建议**：
  1. 引导顺序改为「先取 `levels.json`，成功即用；404/无效再取内置清单」，避免双份下载（注意保留现有「覆盖损坏时回退内置」的行为）。
  2. 对文本资源启用 gzip/br（`node:zlib` 零依赖）并加 `Vary: Accept-Encoding`；关卡 JSON 压缩比通常 >4×。
  3. 章节级懒加载（进入章节才取该章关卡）或把每章合并为单文件，把首屏请求数压到个位数；隐藏章节可延迟到管理员面板需要时再取。
  4. 增加 favicon（内联 SVG 或白名单静态文件），消除玩家浏览器冒烟当前显式容忍的控制台 404。
- **验收**：`tests/server.test.js` 增加 gzip 与 `Vary` 断言；`tests/catalog.test.js` 增加「引导只请求一次清单」的 fetch 桩断言。
