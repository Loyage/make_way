# CONS-1：发布覆盖与内置关卡漂移，且测试只覆盖内置关卡

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P0
- 状态：⬜ 待实施

- **现象**：游戏启动时先读 `built-in-levels.json`，再尝试覆盖清单 `levels.json`；只要覆盖合法就整体替换。
  - 当前工作区同时存在 `levels.json` 与 `levels.local/`，因此**实际对外提供的关卡来自 `levels.local/`**。
  - 三个五日挑战的 `levels.local` 版本**缺少** `campaign.regions`（付费扩建区域）：`levels/road-basics/growing-city.json` 有 4 个区域，`levels.local/road-basics/growing-city.json` 为 0；`junction-campaign`、`transit-campaign` 同样。
  - 实测运行中的服务：`curl :8180/levels.local/road-basics/growing-city.json` → `regions 0`，而 `curl :8180/levels/road-basics/growing-city.json` → `regions 4`；`curl :8180/levels.json` 的章节指向 `levels.local/...`。
- **证据**：
  - `src/game/game-bootstrap.js`：`loadActiveCatalog()` 先 `built-in-levels.json` 再 `levels.json`，覆盖成功即 `setLevels(overrideCatalog)`。
  - `levels.local/` 与 `levels/` 的差异仅上述 3 个文件（`diff -rq levels levels.local`）。
  - 关卡测试全部基于内置清单：`tests/levels.test.js:6`（`require('../src/shared/core.js')` 在 Node 下加载 `built-in-levels.json`）、`tests/server.test.js:7`、`tests/browser-smoke.cjs:5`、`tests/admin-browser-smoke.cjs:7`。
  - `README.md` 与 `src/admin/admin-manual.html` 都宣称付费扩建功能已上线。
- **影响**：玩家玩到的关卡没有被「参考规划器可通关」「扩建/锁定/检查点」测试覆盖；功能发布状态与文档不符，且下一次管理员发布前一直存在。类似的漂移未来还会发生（覆盖文件被 `.gitignore` 忽略，换机器部署即静默切换成内置关卡）。
- **建议**：
  1. 新增 `tests/active-catalog.test.js`：若根目录存在 `levels.json` 则加载它（否则加载内置清单）→ `validateLevelCatalog` + 参考规划器通关 + 五日挑战收入/扩建链路，并断言「覆盖版与内置版的关卡 id 集合、能力位（`campaign.regions`、`busLineLimit` 等）一致」。
  2. 管理员「保存并发布」成功后，面板对比「公开服务返回的关卡指纹」与草稿指纹，不一致就提示需要重启服务（目前只有重启按钮，没有校验）。
  3. 部署说明里补一条：发布后执行一次活动清单校验；`deploy/install-service.sh` 可增加可选的预检调用。
- **验收**：新测试在当前仓库**先失败**（暴露 `regions` 缺失），补齐 `levels.local/` 或改由内置清单提供后通过。
