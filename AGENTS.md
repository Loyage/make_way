# AGENTS.md

## 项目概览

这是一个零依赖、无构建步骤的原生 HTML / CSS / JavaScript 交通规划游戏。关卡通过独立 JSON 文件加载，游戏必须由 `server.js` 通过 HTTP 提供静态资源，不能直接通过 `file://` 打开。

- 运行时要求：现代浏览器；启动服务器和单元测试需要 Node.js 18+
- 可选浏览器冒烟测试：Node.js 22+、Chromium 和本机 Chrome DevTools Protocol（CDP）端点
- 不要引入包管理器、打包器、前端框架或外部 CDN，除非任务明确要求
- 界面和玩家可见提示使用简体中文

## 代码结构

- `src/game/`：玩家页面、游戏指南、样式、Canvas 绘制、输入事件与界面状态
- `src/admin/`：管理员页面、操作手册、样式与编辑器脚本
- `src/shared/`：浏览器 / Node 共用的关卡加载与校验、网格寻路、公交、道路容量、车辆模拟与五日任务
- `src/server/game-server.js`：零依赖、只读、资源白名单式 HTTP 服务实现
- `src/server/admin-server.js`：管理员面板 HTTP 服务；关卡校验位于 `src/shared/level-validation.js`
- `server.js` / `admin-server.js`：保留原启动命令的轻量兼容入口
- `built-in-levels.json`：默认章节路径总清单；`levels/<章节>/chapter.json` 保存本章关卡路径，每关独立 JSON
- `levels.json` / `levels.local/`：管理员生成的可选覆盖清单与分关数据（被 .gitignore 忽略）
- `tests/*.test.js`：Node 内置测试运行器执行的逻辑、关卡和服务器测试
- `tests/browser-smoke.cjs` / `tests/ui-smoke.cjs`：通过 CDP 执行的可选玩家端浏览器集成测试
- `tests/admin-browser-smoke.cjs`：通过 CDP 执行的可选管理端完整流程测试；在浏览器内拦截管理 API，不写入真实关卡文件
- `deploy/`：systemd 用户服务安装脚本及 NixOS 网络配置示例

## 架构约束

1. 浏览器脚本顺序为 `level-catalog.js`、`core-geometry.js`、`core-bus.js`、`core.js`、`core-campaign.js`、`level-validation.js`、其余游戏模块、`game.js`。启动时先递归读取 `built-in-levels.json` 清单，再尝试可选的 `levels.json` 覆盖清单，然后才能创建 `City`。加载后 `TrafficCore.CHAPTERS` 保留层级、`TrafficCore.LEVELS` 提供扁平列表。
2. 核心和关卡加载器同时支持浏览器全局变量与 CommonJS：浏览器使用 `TrafficCore` / `TrafficLevelCatalog`，Node 测试使用 `module.exports`。修改模块边界时须兼容两种环境。
3. 模拟逻辑应留在 `src/shared/core.js`，不要在核心层访问 DOM、Canvas 或 `localStorage`。界面、绘制和输入逻辑放在 `src/game/game.js`。
4. 地图默认 16 × 12，关卡可分别配置 8～64 的宽高。格子使用一维索引 `y * width + x`；优先使用带当前地图宽高的 `key()`、`point()` 和 `neighbors()`，避免边界换行错误。
5. 关卡定义会被递归冻结。每个 `City` 实例必须拥有独立的可变状态，不得修改或在实例间共享可变关卡数据。
6. 道路连接由 `City.edges` 显式表示。相邻道路格不会自动连接；建筑出口和桥梁岸边也必须显式连接。任何建设、剪断、拆除或存档修改都应维护该规则并调用/触发路径刷新。
7. 模拟必须保持确定性。测试通常以 `city.step(0.05)` 推进；不要把核心规则绑定到墙钟时间、动画帧率或随机数。
8. 车辆的当前格、下一格、车道/前后位置和路口冲突区都可能是占用或预约。改动通行规则时，同时检查容量、拆除保护、出口预约、信号相位与自动避让。
9. `src/server/game-server.js` 只暴露 `PUBLIC_FILES`、`levels/` / `levels.local/` 下的 JSON 和 `/healthz`，只接受 GET/HEAD。新增浏览器资源时必须显式更新白名单、MIME 类型和相应服务器测试；不得暴露项目目录、测试或部署文件。
10. HTTP 服务启动时会把资源读入内存。部署后更新前端文件需要重启服务。
11. 管理员面板（`src/server/admin-server.js`）默认绑定 `127.0.0.1` 且**必须设置密码**；显式改用非回环 `ADMIN_HOST` 会对外开放，届时务必使用强密码和 HTTPS。面板写入 `levels.json` 清单与 `levels.local/` 分关数据，缺省时回落到默认清单。

## 编码约定

- 使用现有的普通 JavaScript 与 `'use strict'` 风格，不引入 TypeScript 或转译步骤。
- 遵循邻近代码格式；本项目大量使用短辅助函数、分号和单引号。保持改动聚焦，不要顺手格式化整份文件。
- 所有功能、规则、界面、工作流、配置项和测试入口变更都必须在同一任务中同步更新对应文档，不要等待用户再次提醒，也不能只在对话中说明。
- 玩家端变更必须同步检查并更新 `src/game/manual.html` 游戏指南；管理员端变更必须同步检查并更新 `src/admin/admin-manual.html` 管理员操作手册。共享规则或同时影响两端的行为必须更新两份手册。
- `README.md` 维护项目级功能、启动、部署和测试说明；`GAME_IMPROVEMENT_DIRECTIONS.md` 的完成状态须与实际实现一致。玩家可见文本、ARIA 标签和文档统一使用简体中文。
- 功能改进很可能在分离的 worktree 中进行；改进完成并通过验证后，必须在对应的 `docs/improvements/*.md` 和 `GAME_IMPROVEMENT_DIRECTIONS.md` 中更新完成状态，然后将已完成的改进合并进 `main` 分支，避免只留在分支或 worktree 中。
- 凡是涉及操作逻辑或游戏规则的变更（包括工具、输入方式、建设/拆除规则、车辆出行、道路容量、路口通行、运营控制与快捷键），必须在代码提交前完成上述文档同步。
- 修改 HTML 元素 `id` 时，同步搜索并更新 `src/game/game.js`、CSS 选择器和浏览器冒烟测试。
- Canvas 绘制应按 CSS 尺寸和设备像素比工作，并继续支持鼠标、触摸与键盘操作。
- 设计存档仅保存规划数据，不保存车辆、成绩或计时。修改序列化格式时保留严格校验、原子加载和必要的旧格式迁移。
- 新增或调整教学关卡时，应以短流程和快速正反馈为首要目标：不要设置过长的运营时限或目标等待时间，并随关卡时长相应减少住宅人口与出行流量。流量节奏可参考当前第一章经人工调整后的设计，让玩家无需长时间观看运营动画，即可快速理解新功能、亲手实践并感受到改善效果。
- 不要提交运行时产物、日志、覆盖率目录、浏览器配置目录或其他已被 `.gitignore` 排除的文件。

## 开发与验证

无需安装依赖。常用检查：

```sh
node -e "require('./src/shared/level-catalog.js').loadCatalogSync(require('node:path').resolve('built-in-levels.json'))"
node --check src/shared/level-catalog.js
node --check src/shared/core-geometry.js
node --check src/shared/core-bus.js
node --check src/shared/core.js
node --check src/shared/core-campaign.js
node --check src/game/game.js
node --check src/server/game-server.js
node --check src/server/admin-server.js
node --check server.js
node --check admin-server.js
node --test tests/*.test.js
```

根据改动范围至少运行相关测试；修改核心模拟、关卡或公共行为时运行完整 Node 测试集。新增行为应在最接近的测试文件中加入回归测试：

- 地图、状态、存档和基础模拟：`tests/core.test.js`
- 道路连接与剪断：`tests/connections.test.js`
- 容量、车道、信号灯和交通冲突：`tests/traffic.test.js`
- 关卡数据与可通关性：`tests/levels.test.js`
- HTTP、安全头和资源白名单：`tests/server.test.js`
- 管理员面板验证、登录门禁与 levels.json：`tests/admin.test.js`

关卡测试中的参考规划器用于证明每关在预算和时限内可通关。调整地形、预算、发车间隔、目标或交通规则后，必须重新运行完整测试，不要仅为通过测试而放宽关键不变量。

### 可选浏览器测试

先启动服务：

```sh
node server.js
```

再在另一个终端启动 Chromium（可执行文件名依系统环境而定）：

```sh
chromium --headless --remote-debugging-port=9333 --user-data-dir=/tmp/traffic-game-browser
node tests/browser-smoke.cjs
node tests/ui-smoke.cjs
```

管理端流程测试还需启动管理员服务，再执行：

```sh
ADMIN_PASSWORD=测试密码 node admin-server.js
node tests/admin-browser-smoke.cjs
```

可通过 `GAME_URL`、`ADMIN_URL` 和 `CDP_URL` 覆盖默认地址。管理端浏览器测试会拦截 API，不会发布或写入真实关卡。CDP 调试端口只能监听本机，测试后关闭浏览器。涉及 DOM、Canvas、触摸、响应式布局、对话框、存档或 CSP 的改动应尽量运行对应测试。

## 本地运行与部署注意事项

- 本机检查：运行 `node server.js`，默认监听 `[::]:8180`；健康检查为 `curl --noproxy '*' http://127.0.0.1:8180/healthz`
- 可用 `HOST`、`PORT` 临时覆盖监听地址和端口
- 更新项目代码后应自动重启已有的 `traffic-game.service`；但运行 `deploy/install-service.sh`、修改其他 systemd 状态、开放防火墙或执行 NixOS 重建仍须先征得用户确认
- 此环境使用 Nix 管理软件和系统配置；需要工具时使用 Nix，禁止擅自使用 `apt`、`yum`、`brew` 或全局 npm 安装
- NixOS 配置仓库的变更按其自身说明通过 `just switch` 应用；不要覆盖用户现有配置

### 更新代码后的服务刷新

`server.js` 会在启动时把静态资源读入内存，因此部署目录中的项目代码更新并验证通过后，Agent 应主动刷新已安装的用户服务，无需再次征求用户确认：

1. 执行 `systemctl --user restart traffic-game.service`。
2. 执行 `systemctl --user --no-pager status traffic-game.service`，确认服务处于 `active (running)`。
3. 执行 `curl --fail --noproxy '*' http://127.0.0.1:8180/healthz`，确认健康检查成功。
4. 如重启失败，应检查日志和端口占用并处理可明确归属于本项目的遗留进程，然后再次重启并验证；不要终止来源不明的进程。
5. 如果改动了 `deploy/install-service.sh` 中的 unit 配置，应先征得用户确认再运行 `bash deploy/install-service.sh`，而不是只重启旧 unit。

只有用户明确要求不要部署或当前环境未安装该服务时，才跳过自动重启，并在结果中说明原因。

## 提交前检查清单

- 工作区可能包含用户尚未提交的修改；先查看 `git status`，不要覆盖、还原或顺带提交无关变更
- 核心层仍可在无 DOM 的 Node 环境加载
- 页面仍可在无网络、无第三方资源时运行
- 新增静态资源已加入服务器白名单和测试
- 玩家功能已同步 `src/game/manual.html`，管理员功能已同步 `src/admin/admin-manual.html`；共享行为已更新两份手册
- README、改进方向、界面文本、ARIA 标签和测试保持一致
- 分离 worktree 中完成的功能改进已更新对应改进条目和 `GAME_IMPROVEMENT_DIRECTIONS.md`，并已合并进 `main` 分支
- 已执行适合改动范围的语法检查和测试，并如实报告未执行的可选浏览器测试
