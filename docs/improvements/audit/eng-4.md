# ENG-4：管理员页面注入依赖精确字符串

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P2
- 状态：⬜ 待实施

- **现象**：`src/server/admin-server.js` 的 `loadAssets()` 用 6 次 `String.replace()` 把面板与脚本注入 `index.html`（匹配 `<title>…</title>`、`'</aside>\n      </div>\n      <section id="accessible-map"'` 等）；任何标题改动或缩进变化都会让管理员服务启动失败（`throw new Error('Unable to compose unified administrator page')`）。
- **建议**：在 `index.html` 放置显式注释锚点（`<!-- admin-panel -->`、`<!-- admin-scripts -->`），注入逻辑改为按锚点替换；并加一条针对锚点存在性的启动自检（当前已有 compose 自检，可保留）。
- **验收**：`tests/admin.test.js` 增加「锚点缺失时报错」与「标题改写后仍可注入」用例。
