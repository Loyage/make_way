# 慢行小城 · 可改进点清单（dsim.md）

> 用途：把「值得改、怎么改、怎么验证」一次说清，作为后续排期的输入。
> 范围：玩家端、关卡与教学、模拟核心、服务端、管理员面板、文档与测试流程。
> 基线：`8d68fd6 feat(campaign): add paid map region expansion`，`node --test tests/*.test.js` = 201 通过 / 0 失败（约 31 s）。
> 方法：静态走查（`src/**`、`tests/**`、`README.md`、两份手册）＋ 可复现实测（见文末附录）＋ 与实际运行服务（`:8180`）对照。
> 优先级：**P0** = 影响正确性/规模可用性；**P1** = 明显损伤体验或维护效率；**P2** = 打磨型改进。
> 与其他文档的关系：本文件是「问题清单 + 证据 + 验收方式」；`GAME_IMPROVEMENT_DIRECTIONS.md` 是「已实现 / 进行中 / 待实施」的状态路线图。两者需要交叉引用，避免同一项在两处给出相反状态。

> **工作区状态提醒**：撰写期间工作区正在并发修复部分条目（`README.md`、`src/game/manual.html`、`src/game/index.html` 的快捷键与 ARIA 标签，新增 `tests/docs.test.js`，并恢复了 `GAME_IMPROVEMENT_DIRECTIONS.md`）。因此 CONS-2 与 CONS-5 在当前工作区**已修复但未提交**，A11Y-4 只剩画布部分；其余条目不受影响。

---

## 0. 摘要（先看这一张表）

| ID | 问题 | 影响 | 优先 | 成本 |
| --- | --- | --- | --- | --- |
| CONS-1 | 线上关卡（`levels.local/`）与内置关卡（`levels/`）漂移，三个五日挑战丢失「付费扩建」 | 玩家实际玩到的关卡与文档/测试不一致 | **P0** | 小 |
| PERF-1 | `occupants()` 为 O(车辆数) 且每次新建数组，使 `step()` 与寻路退化为 O(V²) | 大图/高车流时模拟慢于实时，标签页卡死 | **P0** | 中 |
| PERF-2 | 每帧 2 次数值寻路（`draw()` + 检查器） | 选中住宅时单独吃掉整帧预算（实测 6–9 ms/次） | **P0** | 小 |
| PERF-3 | 无障碍网格 4096 个按钮全部 `tabIndex=-1`，且每 0.5 s 重写全部 `aria-label` | 号称「可逐格读取」实际不可达，同时是纯开销 | P1 | 小 |
| PERF-4 | 每帧无条件 `updateUI()+draw()`，含全量满意度扫描与 DOM 重建 | 60 fps 级 DOM 写入与 GC 压力，移动端耗电 | P1 | 中 |
| PERF-5 | 启动拉取两套关卡清单（约 390 KB / 约 50 请求），无 gzip、无懒加载 | 首屏慢，移动网络明显 | P1 | 小 |
| SIM-1 | 道路等级无取舍：每点车道数相同、速度递增 ⇒ 高级路严格更优 | 「道路等级」教学关缺少真实决策 | P1 | 小 |
| SIM-2 | 无单向道 / 环岛（`edges` 为无向图） | 交通规划题材缺失最经典的两类工具 | P1 | 大 |
| SIM-3 | 无分时段需求曲线 | 信号配时（2.5）缺少非高峰空放场景 | P1 | 中 |
| A11Y-1 | 键盘光标移出视口后地图不跟随滚动 | 大图无法用键盘规划 | P1 | 小 |
| ENG-1 | 无 CI、无统一命令入口（无 `package.json`/`justfile`/CI 配置） | 201 个测试依赖手工执行，易回归 | P1 | 小 |
| ENG-2 | 浏览器冒烟测试不在 `node --test` 内、依赖本机 Chromium | 长期失效无人发现 | P1 | 小 |
| CONS-2 | `README.md` 快捷键表与真实按键不一致（4 处） | 玩家按错模式 | ~~P1~~ ✅ 工作区已修复 | 极小 |
| CONS-3 | README 描述的「另存为配置 / 覆盖默认配置」在面板没有入口 | 文档承诺了不可用功能 | P1 | 小 |
| CONS-4 | 发布的「人工试玩」门禁只在前端，`PUT /api/levels` 不校验 | 手册与实现不一致，门禁可绕过 | P1 | 小 |

---

## 1. 正确性与一致性

### CONS-1【P0】发布覆盖与内置关卡漂移，且测试只覆盖内置关卡

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

### CONS-2【✅ 已在工作区修复（未提交）】README 快捷键与真实按键不一致

- **现象**：实际界面是 `1 观察 / 2 选择 / 3 拖拽 / 4 剪刀 / 5 公交线`（`src/game/index.html` 工具栏、`src/game/game.js:1349`、`src/game/manual.html` 全部一致）。
  `README.md` 却写成「选择模式（1）…拖拽模式（2）…剪刀模式（3）…公交线模式（4）」以及快捷键表 `` `1`/`2`/`3`/`4` → 选择 / 拖拽 / 剪刀 / 公交线 ``。
- **证据**：`README.md:128-131`、`README.md:146` 对比 `src/game/index.html:31` 与 `manual.html` 的 MODE 01–05 标题。
- **建议**：按 `manual.html` 校正 README 的操作章节与快捷键表；并在 `tests/` 里加一条静态断言（读取 `index.html` 的 `kbd` 文案与 README 表格比对），避免再次漂移。
- **现状**：工作区已按上述方案修正（`README.md:98`、`README.md:128-132`、`README.md:146`），并新增 `tests/docs.test.js` 做「UI / 帮助对话框 / 指南 / README / 键盘处理」五方一致性断言，同时扩展了 `tests/browser-smoke.cjs` 的 `1`–`5` 按键断言。本条可关闭；后续只需保证该测试进入 CI（见 ENG-1/ENG-2）。

### CONS-3【P1】README 宣称的「另存为配置 / 覆盖默认配置」在面板没有入口

- **现象**：`README.md:51` 描述管理员可「另存为配置」（写入 `level-presets/`）与「覆盖默认配置」（重建 `levels/` 并更新 `built-in-levels.json`）。服务端确实实现了 `PUT /api/presets/<name>` 与 `PUT /api/default`（`src/server/admin-server.js:278-302`、`303-315`），并有测试（`tests/admin.test.js:213`）；但 `src/admin/admin-panel.html` 里没有任何对应按钮，`src/admin/admin.js` 也从不请求这两个接口。
- **影响**：文档承诺了不可用功能；两段已测试的服务端代码没有使用方（除测试外为死路径）。
- **建议**：二选一——(a) 在控制台补「另存为配置 / 载入配置 / 覆盖默认配置」入口（含确认与重名校验提示）；(b) 若有意只保留 API/CLI，则改写 README 与管理员手册，标注为「HTTP 接口，需自行调用」。
- **验收**：面板按钮或文档二选一后一致；若补 UI，`tests/admin-browser-smoke.cjs` 增加一次预设往返。

### CONS-4【P1】「人工试玩」门禁只在前端

- **现象**：`src/admin/admin.js` 用浏览器内存里的 `verifiedLevels`（关卡指纹）阻止发布，`admin-manual.html` 也声明「只在完整校验和人工通关门禁均通过后写盘」。但 `PUT /api/levels`（`src/server/admin-server.js:261-275`）只做 `validateLevels` + `validateReferenceChains`，不校验任何试玩凭证。
- **影响**：门禁可通过直接调用 API 绕过；手册与实现不一致（也会误导「发布内容一定被人工通关过」的假设）。
- **建议**：服务端记录「已试玩验证」的 `levelId + 指纹`（内存即可，重启失效），`PUT /api/levels` 拒绝未验证关卡；或明确降级为「前端提示 + 服务端结构校验」并同步手册措辞。注意与 `CONS-1` 的发布自检一起设计。
- **验收**：`tests/admin.test.js` 增加「未带试玩凭证的 PUT 被拒绝」用例（若选方案 A）。

### CONS-5【✅ 已在工作区修复（未提交）】`AGENTS.md` 引用了已删除的改进文档

- **现象**：`AGENTS.md:47` 要求「`GAME_IMPROVEMENT_DIRECTIONS.md` 的完成状态须与实际实现一致」，但该文件在历史中已被删除（`git log --diff-filter=D` 可见），当前仓库不存在。
- **建议**：把该条指引改为指向本文件（`dsim.md`），或恢复一份「已实现 / 待实现」状态表；两者取其一，避免新人按不存在的文件操作。
- **现状**：工作区已恢复 `GAME_IMPROVEMENT_DIRECTIONS.md`（含状态图例、已实现能力盘点与路线图）。**请注意**：该文件与本 `dsim.md` 有职责重叠，落地时需明确——建议 `GAME_IMPROVEMENT_DIRECTIONS.md` 记「状态」，`dsim.md` 记「证据与验收」，并在两处互相链接。

### CONS-6【P2】观察模式下按空格给出误导提示

- **现象**：`src/game/game.js:1391` 在非规划模式下按空格会 `selectSingleCell()` 并提示「请使用下方区域操作区」，但 `setTool()` 只在 `select` 模式显示 `#road-inspector`（`game.js:280`），观察模式下面板是隐藏的。
- **建议**：观察模式下忽略空格，或提示「按 2 切换到选择模式后可查看该格信息」，并顺带 `setTool('select')`。

### CONS-7【P2】死代码与遗留开关

- `src/shared/core.js:78`：`SIGNAL_ENTRIES` 定义后从未使用（真正使用的是每次传入 `width` 的 `signalEntries()`）。
- `core.js:146/995`：`deadlineMode` 只有测试在设置（`tests/traffic.test.js:10` 等），游戏运行路径从不使用。
- `src/game/game.js` `#load-design` 处理里 `if (city.state === 'running') city.toggle();` 位于 `state !== 'planning'` 提前返回之后，不可达。
- `src/admin/admin.js` 章节编辑连续三次 `prompt()`、删除用 `confirm()`，与游戏内自定义对话框风格不一致，移动端体验差。
- **建议**：清理死代码；把管理员章节编辑改为面板内表单/对话框。

### CONS-8【P2】星级阈值与教学时限缺少一致梯度

- **数据**（内置清单）：

  | 章节 | 关卡时限 | 满意度星 | 效率星最大住宅排队 |
  | --- | --- | --- | --- |
  | 道路入门 | 30 s | 90% | 2–10 人 |
  | 路口调度 | 70–130 s（最长 signal-demand 130 s） | 30–45% | 20–80 人 |
  | 公共交通 | 55–75 s | 45% | 80 人 |

- **问题**：第一章反而是最严的（90% 满意度、排队 ≤2）；第二章时限 70–130 s、客流 8–16 人/s，与 `AGENTS.md`「教学关卡以短流程和快速正反馈为首要目标……流量节奏可参考当前第一章经人工调整后的设计」相冲突。
- **建议**：统一成可解释的曲线（例如「满意度星随章节递减 90→70→60，排队上限随人口等比放大」），并把第二章压到 45–75 s 并同比下降人口/产生率。改动后必须重跑 `tests/levels.test.js` 的参考规划器与 `verifyCampaignReferenceChain`。

### CONS-9【P2】8–64 地图能力没有真实使用

- **现象**：17 个可见关卡全部为 `16 × 12`（内置清单实测），只有管理员能设置其他尺寸；而画布固定 `aspect-ratio: 4/3`（`src/game/style.css:1`），非 4:3 地图会留白，且没有大规模关卡的性能回归测试（见 PERF-1/ENG-2）。
- **建议**：至少提供 1 个中/大地图关卡（顺带验证缩放、聚焦、键盘规划与性能）；同时按 `city.width/height` 动态设置 `canvas.style.aspectRatio`。

---

## 2. 性能

> 实测环境：Node v24（`node --test` 同版本），合成关卡脚本见附录 A。数字为单次 `city.step(0.05)` 的平均耗时。

### PERF-1【P0】`occupants()` 是 O(车辆数)，并把 `step()` 与寻路拖成 O(V²)

- **现象**：`City.occupants(n, self)` 每次都 `[...this.cars, ...this.buses].filter(...)`，即「新建两个数组 + 全量扫描」。它被 `laneFor()`、`junctionAvailable()`、`load()`、`exitLocked()`、编辑保护等高频路径调用；`step()` 每辆车每步至少调用 1–3 次，`dynamicRoadTravelCost()`（改道与检查器寻路）也依赖 `load()`/`occupants()`。
- **证据**：
  - `src/shared/core.js:489`（`occupants`）、`496-497`（`junctionAvailable`）、`501/510`（`laneFor`/`load`）、`299`（动态成本）。
  - 调用计数（16×12、10 条走廊、90 辆车）：**每步 `occupants` 241 次、`reservations` 274 次**（后者每次又为每辆车分配对象）。
  - 规模实测（64×64、N 条 62 格走廊、快速路等级）：

    | 走廊数 | 在途车辆 | 每步耗时 |
    | ---: | ---: | ---: |
    | 15 | 765 | **100 ms** |
    | 30 | 1530 | **343 ms** |
    | 60 | 3060 | **1345 ms** |

    车辆数 ×4 → 耗时 ×13.4，呈平方级增长。以 20 步/秒（1× 速度）计，765 辆车时已经需要 2 s 机时/模拟秒，3060 辆车时约 27 s/模拟秒（标签页直接失去响应）。
- **建议**：
  1. 增加按格占用索引：`this.occupancy = Map<cell, Set<vehicle>>`（另按 `heading` 分桶，或对每格缓存 `{counts, slots}`），车辆进入/离开格时增量维护；`occupants/load/laneFor/junctionAvailable/exitLocked` 改为查索引，避免展开整表。
  2. `reservations(vehicle)` 改为复用固定对象（或在索引里直接保存 slot 描述），消除每步数万次短命对象。
  3. 顺带把 `load()` 的「最忙方向」计算改为索引内维护的每方向计数。
- **验收**：新增 `tests/performance.test.js`，先用当前实现记录基线（765/1530/3060 辆车的每步耗时），修复后阈值设为基线的 1/5 以内；同时断言 `step()` 中 `occupants` 调用不再随车辆数增长（可用计数桩）。

### PERF-2【P0】选中住宅时每帧执行两次完整寻路

- **现象**：
  - `frame()` 每帧调用 `updateUI()` 与 `draw()`（`game.js:1397-1411`）。
  - `draw()` → `selectedHomeTravelInfo()` → `city.homeTravelInfo()`（`game.js:741/353-356`）。
  - `updateUI()` → `updateInspector()` → `city.homeTravelInfo()`（`game.js:890/475/525`）。
  - `homeTravelInfo()` 会跑 `bestGoalPath()`（Dijkstra，运营中还使用动态拥堵成本）。
- **实测**：64×64 地图、760 辆车时 **`homeTravelInfo` ≈ 6.3–8.8 ms/次**（走廊仅 62 格，成本主要来自对每格调用 `load()`/`occupants()`）。两次/帧 ≈ 12–18 ms，仅此一项就吃满 60 fps 预算。
- **建议**：
  1. 按「设计指纹 + 关卡状态 + 0.25 s 时间片」缓存 `homeTravelInfo`，`draw()` 直接复用检查器结果。
  2. 与 PERF-1 一起修：缓存修复后同样的寻路会便宜一个数量级。
  3. 检查器文本更新降频到 5–10 Hz（见 PERF-4）。
- **验收**：`tests/canvas.test.js` / 新增 UI 单测断言「同一 tick 内 `homeTravelInfo` 只计算一次」；浏览器冒烟测试在运营中选中住宅时不再出现掉帧断言（可加 `performance.now()` 采样）。

### PERF-3【P1】无障碍网格既不可达又昂贵

- **现象**：`buildAccessibleMap()` 为每格创建一个 `<button role="gridcell">`（最大 64×64 = 4096 个），但 `updateAccessibleMap()` 每次都把所有单元格设为 `tabIndex = -1`，因此没有任何入口可以 Tab 进入；同时 `role="grid"` 的直接子元素全是 `gridcell`，缺少 `role="row"`，ARIA 结构无效。
  另外 `updateAccessibleMap()` 的签名包含 `Math.floor(city.elapsed*2)`，即**每 0.5 s 重写全部 `aria-label`**；`accessibleCellLabel()` 内部对道路格调用 `city.load(cell)`（O(V)）并扫描 `planningHints`（O(格数 × 提示数)）。
- **证据**：`game.js:224-227`（创建 `role="grid"`/`gridcell`）、`game.js:229-232`（全部 `tabIndex=-1` 与全量标签写入）、`game.js:966`（每帧调用）。网格容器见 `index.html:31`。
- **建议**：
  1. 改为 roving tabindex（只有当前格 `tabIndex=0`，方向键在格间移动并同步画布光标），补齐 `role="row"`/`aria-rowindex`/`aria-colindex`。
  2. 只在「选中格 ± 视口范围」（或视口内可见格）更新标签，并把 `elapsed` 从签名里去掉（改为按事件更新）。
  3. 如果保留「整格朗读」而无法访问，不如改为单个 `aria-live` 文本区播报当前格，删除 4096 个按钮。
- **验收**：`tests/ui-smoke.cjs` 增加「Tab 可进入网格、方向键可移动、`aria-rowindex` 递增」断言；性能上断言 0.5 s 内不重写全部格标签（可 stub 计数）。

### PERF-4【P1】每帧无条件更新界面

- **现象**：`frame()` 每帧 `updateUI()` + `draw()`，即使规划中/暂停/无变化；`updateUI()` 里还有：
  - `liveSatisfactionReport()`：把 `city.queueTimes`（每产生一位居民追加一次）和 `city.commuteTimes`（每抵达一位追加一次）**全量**拼进新数组（`game.js:860-868`）；
  - `updateInspector()`（`game.js:475`）大量 `textContent` 写入与字符串拼接；
  - `updateBusLineInspector()`（`game.js:394-397`）每帧 `replaceChildren()` 并按线路重建 DOM；
  - `renderCampaignProgress()`、`updatePlanningHints()` 有签名缓存（较好），但 `updateAccessibleMap()` 见 PERF-3。
- **影响**：桌面端持续的 60 fps DOM 写入 + GC 压力；移动端耗电与发热；大人口关卡下满意度扫描随人口线性增长。
- **建议**：
  1. 引入脏标记：设计/状态/统计变化时才刷新文本类 HUD，其余时间 5–10 Hz 节流；画布保持 60 fps，但空闲（无动画、无车辆移动）时跳过重绘。
  2. `liveSatisfactionReport()` 改为增量维护直方图（分档计数 + 总时长），避免每帧 O(人口) 扫描。
  3. `updateBusLineInspector()` 的 DOM 只在选择格/线路数据变化时重建。
- **验收**：新增 `tests/ui-timing.js`（或在 ui-smoke 中）统计规划状态下 3 s 内的 DOM 写入次数/帧时间；配合 `prefers-reduced-motion` 与后台标签页做冒烟。

### PERF-5【P1】启动拉取两套关卡清单，且无压缩

- **现象**：`loadActiveCatalog()` 先取 `built-in-levels.json` 及其 4 个章节、22 个关卡文件，再取 `levels.json` 与 `levels.local/` 的整套（重复内容）。实测 JSON 体积：内置 196 851 B + 覆盖 194 064 B ≈ **390 KB，约 50 个请求**；另加 JS/CSS 346 788 B。服务端没有任何压缩（`src/server/game-server.js` 未使用 `node:zlib`），并且把隐藏的「设计素材库」也一并下载。
- **建议**：
  1. 引导顺序改为「先取 `levels.json`，成功即用；404/无效再取内置清单」，避免双份下载（注意保留现有「覆盖损坏时回退内置」的行为）。
  2. 对文本资源启用 gzip/br（`node:zlib` 零依赖）并加 `Vary: Accept-Encoding`；关卡 JSON 压缩比通常 >4×。
  3. 章节级懒加载（进入章节才取该章关卡）或把每章合并为单文件，把首屏请求数压到个位数；隐藏章节可延迟到管理员面板需要时再取。
  4. 增加 favicon（内联 SVG 或白名单静态文件），消除控制台 404（`tests/browser-smoke.cjs:23` 目前显式容忍它）。
- **验收**：`tests/server.test.js` 增加 gzip 与 `Vary` 断言；`tests/catalog.test.js` 增加「引导只请求一次清单」的 fetch 桩断言。

### PERF-6【P2】∞× 管理员模式同步空转

- **现象**：`game.js:1401-1403` 在一个 `for` 循环里跑完整个时限（最多 `duration/0.05` 步），全程不 yield。配合 PERF-1，大地图会把页面冻住数十秒甚至更久。
- **建议**：分片执行（每帧 N 步 + 进度条），或改用 `setTimeout(0)` 分批；同时给 `maxSteps` 设上限并提示。

---

## 3. 模拟规则与玩法深度

### SIM-1【P1】道路等级缺乏取舍，「越快越好」没有代价

- **数据**（`ROAD_TYPES`，`core.js`）：

  | 等级 | 每格费用 | 速度 | 每方向车道 | 每方向容量 | 每点车道 | 每点速度 |
  | --- | ---: | ---: | ---: | ---: | ---: | ---: |
  | 支路 | 1 | 2.8 | 1 | 2 | 1.0 | 2.8 |
  | 干道 | 2 | 4.0 | 2 | 4 | 1.0 | 2.0 |
  | 快速路 | 3 | 5.2 | 3 | 6 | 1.0 | 1.73 |

  每点预算买到的车道数完全相同，而速度、转向车道分工（`turnLane()`）、路口疏解都随等级变好；同时没有维护费、占地代价、噪声/宜居指标，信号灯也是免费且即时生效。结论：**只要预算允许，把每格升到最高等级是严格最优**，玩家不需要在等级之间权衡（降级只有在预算不足时才被动发生）。
- **影响**：第二章「道路入门/路口调度」关于等级的教学缺少真实决策，深度被论文式的「更快更好」压缩。
- **建议**（择一或组合，都要相应更新两份手册与 `GAME_IMPROVEMENT_DIRECTIONS` 状态）：
  1. 引入按日/按秒的养护成本（多日任务中从收入扣除），让高级路有持续代价；
  2. 或给高级路加结构性限制（例如建筑出口只能接支路/干道、快速路不接受建筑出口或必须成对单向）；
  3. 或让等级差价的边际收益递减（例如快速路速度 4.6 而不是 5.2）。
- **验收**：`tests/traffic.test.js` 增加「同预算下不存在无条件支配解」的性质断言；`tests/levels.test.js` 参考规划器的花费/星级必须重算。

### SIM-2【P1】没有单向道与环岛

- **现象**：`City.edges` 为无向邻接（`addEdge`/`removeEdge` 对称），`cut()` 只能整条删除连接；道路引导只有「偏好 / 汽车禁行」（`setRoadPolicy`），没有方向性。
- **影响**：单向道、单行循环、环岛是交通规划题材最经典的三类工具，也是「用最少资源疏解路口」的主要手段；目前玩家只能靠升级道路和调信号。
- **建议**：把 `edges` 升级为有向（或增加 `oneWay: Map<cell, heading>`），需要同步修改：`refreshPaths()`/`findCarPath`、`laneFor`、建筑出口连接、公交线路合法性校验（`busUsesEdge`）、剪断工具、存档 v9 迁移与 `level-validation.js`。工作量较大，建议单独立项。
- **验收**：新增 `tests/oneway.test.js`（逆行车不能通行、存档往返、参考规划器兼容）；`tests/connections.test.js` 扩展剪断/连接用例。

### SIM-3【P1】没有分时段需求曲线

- **现象**：`step()` 中需求按固定 `generationRate` 线性产生（`core.js:875-885`），没有「早高峰 / 平峰 / 晚高峰」。设计素材库里的 `rush-hour` 只是恒定的高产生率。
- **影响**：信号配时教学（2.5「为不对称流量分别设置 2/4/6 秒绿灯」）只能演示静态配时，无法体现「高峰长放、平峰空放」的核心概念；玩家不会遇到「优化一个时段却拖慢另一个时段」的取舍。
- **建议**：关卡（尤其是 campaign day）支持可选的 `demandCurve`（例如按比例的时间片列表），`step()` 用它缩放各住宅的产生率；结算与星级可增加「峰值等待」指标。UI 需要一条简单的时间轴与当前需求倍率显示。
- **验收**：`tests/demand.test.js` 增加曲线缩放与人口守恒用例；`levels.test.js` 的参考答案需按曲线重跑。

### SIM-4【P2】公交缺少运营成本与专用道

- **现象**：公交只有一次性建设费 `BUS_COST = 6`（`core.js`），没有按天/按圈的运营成本，也没有收入分成；`bus-only-street` 关卡用「汽车禁行」实现强制通勤，但核心没有「公交专用道」（只有整格 policy）。
- **建议**：多日任务中为每辆公交增加每日维护费（或把公交载客量计入收入权重），让「修路 vs 增开公交」成为真实取舍；`setRoadPolicy` 增加 `bus-only`（公交可走、汽车绕行），可复用现有 `roadTravelCost` 的 `avoid` 逻辑。
- **验收**：`tests/bus.test.js` 增加成本/预算与 `bus-only` 选路用例；`tests/levels.test.js` 重算公交关星级。

### SIM-5【P2】「慢行」主题缺失

- **现象**：游戏名「慢行小城 / Make Way」与「慢行」（步行、自行车）相关，但模拟中只有小汽车与公交，没有行人、自行车、过街或限速区。三章主题是道路—路口—公交。
- **建议**：规划第四章「慢行优先」（人行道/过街相位、自行车道、公交优先与限速、学校周边减速），既补齐命名，也提供一个与「提速」相反的规划维度（当前所有工具都指向更快）。
- **验收**：新章关卡通过 `validateLevelCatalog` 与参考规划器；`README.md` 章节介绍与两份手册同步；`tests/levels.test.js` 的章节断言需更新。

### SIM-6【P2】没有进度持久化，玩家体验割裂

- **现象**：`localStorage` 只保存设计、星级、个人最佳、参考答案解锁（`game.js:30-33`），**不保存当前关卡与五日任务进度**；刷新后回到第一关（README 也承认）。但星级/最佳保留，于是「星还在、进度没了」。
- **建议**：保存 `lastLevelId / campaignDay / design / 已完成日期`，启动时提供「继续上次运营」或在关卡列表标注「上次到这里」；退出确认可提示可恢复。
- **验收**：`tests/ui-smoke.cjs` 增加「重载后停留/可恢复到上次关卡」用例；README 的操作说明同步。

### SIM-7【P2】存档无法导出、导入或分享

- **现象**：设计只存在浏览器 `localStorage`（`STORAGE_PREFIX`），没有导出文件/文本、导入、URL 分享。
- **建议**：增加「复制设计代码 / 粘贴导入」与可选的 `#design=...` 深链（hash 不会触发网络请求，注意 `default-src 'none'` 下仍可解析）；对管理员也有价值（收集玩家方案复现 bug）。
- **验收**：新增 `tests/design-share.test.js`（序列化 → 解析 → `loadDesign` 往返，含损坏输入拒绝）；手册同步。

### SIM-8【P2】没有声音与暗色主题

- **建议**：用 WebAudio 合成少量提示音（建成、贯通、送达、结算），默认关闭并在「减少动态效果」旁提供开关；提供 `prefers-color-scheme: dark` 的暗色变量集。两者都不需要外部资源。
- **验收**：`tests/ui-smoke.cjs` 检查暗色模式下的取色/对比与开关持久化。

---

## 4. 无障碍与移动端

### A11Y-1【P1】键盘光标移出视口后地图不跟随

- **现象**：键盘方向键只更新 `keyboardCell` 并 `announceCell()`（`game.js:1368-1374`），从不调整 `viewX/viewY`；观察模式的方向键只平移地图（`game.js:1361`）。因此在大地图（尤其非 16×12）上，光标会走出可视区，键盘用户立即迷失。
- **建议**：光标移动后若目标格不在视口内，复用 `viewTarget` 平滑滚动到居中；同时在画布边缘显示光标指示箭头。
- **验收**：`tests/ui-smoke.cjs` 用键盘移动到远格后断言该格在画布可视区域内。

### A11Y-2【P1】ARIA 网格不可达且结构无效

见 PERF-3（同一处代码，既是可达性问题也是性能问题）。

### A11Y-3【P2】画布禁止页面缩放、文字最小 8–10 px

- **现象**：`canvas{touch-action:none}`（`style.css:1`）阻止了双指页面缩放；画布内文字按格子尺寸缩放（大地图缩小时会小于 8 px），HUD 中也有 `font-size:9px`/`10px` 的小字（如 `.map-footer`、`.stat-label small`）。
- **建议**：提供「界面字号 / 最小格子尺寸」档位；画布内标签设置下限（当前 `label()` 无最小值），低视力用户可把小地图改大而非依赖页面缩放。
- **验收**：`tests/ui-smoke.cjs` 断言 320–1440 px 六档下关键文字 ≥ 12 px（画布外）。

### A11Y-4【P2】画布 `aria-label` 不随模式更新

- **现象**：`index.html:31` 的画布 `aria-label` 是长段静态说明；切换工具只更新工具栏的 `aria-pressed`（工作区已为五个工具按钮补上 `aria-label="…模式，快捷键 N"`），画布自身标签仍不变；`aria-describedby="map-accessible-status"` 的 live region 只在移动光标时更新。
- **建议**：`setTool()` 中同步更新画布 `aria-label`（例如「拖拽模式：从起点按住并拖动铺设道路」），并在工具切换时向 live region 播报一次模式变化；`tests/docs.test.js` 已覆盖工具栏标签，可顺带断言画布标签随模式变化。

---

## 5. 工程与流程

### ENG-1【P1】没有 CI，也没有统一命令入口

- **现象**：仓库无 `.github/`、无 `package.json`、无 Makefile/justfile；`AGENTS.md` 用 10 条 `node --check` + `node --test` 手工列出检查项。
- **影响**：201 个测试全靠人工记忆执行；本机（Nix + `just`）与协作者环境不一致时容易漏跑。
- **建议**：加 `justfile`（`just check` / `just test` / `just serve` / `just bench`）或 `scripts/check.sh`，再加一个零依赖的 GitHub Actions 工作流（`actions/setup-node` + 上述脚本）；可选 job 安装 Chromium 跑 `tests/*.cjs`。不引入 npm 依赖，保持无构建。
- **验收**：CI 上 `just check` 全绿；README 的「开发与测试」改为指向该入口。

### ENG-2【P1】浏览器冒烟测试长期处于「可选且易失效」状态

- **现象**：`tests/browser-smoke.cjs`、`ui-smoke.cjs`、`admin-browser-smoke.cjs` 需要手动启动服务和本机 Chromium CDP，不在 `node --test tests/*.test.js` 内，因此常年不执行（例如 `ui-smoke.cjs:95` 的 44 px 触控断言、`browser-smoke.cjs:23` 的 favicon 容忍逻辑都不会被验证）。
- **建议**：把三个脚本纳入 CI 的可选 job（`nix shell nixpkgs#chromium` 或环境变量指定浏览器），或在 `tests/` 增加 `npm`-free 的自检脚本 `tests/browser-smoke.sh` 负责启动/清理；至少让「最近一次执行结果」可见。
- **验收**：CI 中出现浏览器 job 的执行日志（允许在无 Chromium 环境下 skip 并显式报告）。

### ENG-3【P1】`game.js`（1457 行）没有单元测试

- **现象**：核心、关卡、公交、服务器都有独立测试；玩家界面唯一的纯逻辑大文件 `game.js` 只有浏览器冒烟覆盖。其中不少是纯函数/纯状态机，可无 DOM 测试：`paint()` 的斜拖插值、`operationRoads/operationSummary`、`roadSegment`、`designHistory` 记录与恢复、`campaignConditionText`、`starTargetsFor`、`focusInitialView`/`viewBounds` 的钳制。
- **建议**：按现有模块化风格再拆出 `game-drafts.js`（拖拽/选区/历史）与 `game-hints.js`（提示与文案），同时给它们加 `tests/*.test.js`；`game.js` 只保留事件绑定与编排。
- **验收**：新增至少 15 条无 DOM 单测覆盖上述函数；`node --check` 与浏览器冒烟仍通过。

### ENG-4【P2】管理员页面注入依赖精确字符串

- **现象**：`src/server/admin-server.js` 的 `loadAssets()` 用 6 次 `String.replace()` 把面板与脚本注入 `index.html`（匹配 `<title>…</title>`、`'</aside>\n      </div>\n      <section id="accessible-map"'` 等）；任何标题改动或缩进变化都会让管理员服务启动失败（`throw new Error('Unable to compose unified administrator page')`）。
- **建议**：在 `index.html` 放置显式注释锚点（`<!-- admin-panel -->`、`<!-- admin-scripts -->`），注入逻辑改为按锚点替换；并加一条针对锚点存在性的启动自检（当前已有 compose 自检，可保留）。
- **验收**：`tests/admin.test.js` 增加「锚点缺失时报错」与「标题改写后仍可注入」用例。

### ENG-5【P2】关卡格式没有文档化 schema

- **现象**：关卡格式的事实规范是 `src/shared/level-validation.js`（398 行），没有 `docs/level-format.md`，也没有 JSON Schema；管理员手册只描述界面字段。
- **建议**：输出 `docs/level-format.md` + `levels.schema.json`（可由校验器手工同步），让编辑器提供补全/校验，也便于第三方贡献关卡。
- **验收**：新增测试断言「所有内置关卡满足 schema」（可用轻量校验脚本，避免引入依赖）。

### ENG-6【P2】细节打磨

- 仓库没有 `LICENSE`（README 也未说明授权），对外分享前应补一份。
- 服务端 CSP 的 `style-src 'self' 'unsafe-inline'` 可以收窄为 `style-src 'self'; style-src-attr 'unsafe-inline'`（页面没有内联 `<style>`，只有 JS 设置的 style 属性），同时 `tests/server.test.js` 增加断言。
- `Cache-Control: no-cache` + ETag 会让每次刷新都发约 50 次条件请求；与 PERF-5 的压缩/懒加载一起优化效果更好。
- 游戏服务与管理员服务各自维护一份 `SECURITY_HEADERS`/资源白名单，容易漂移；建议抽出共享模块并加一致性测试。

---

## 6. 建议路线图

**第一波（正确性与体感，1–2 天）**
1. CONS-1 活动清单测试 + 补齐 `levels.local`（或改发布流程），并在管理员面板显示「公开服务关卡指纹」。
2. PERF-2 检查器寻路缓存（低成本、立竿见影）。
3. PERF-3 无障碍网格改为 roving tabindex + 视口范围内更新。
4. CONS-3 文档校正（README 的预设/默认配置入口）；CONS-2 与 CONS-5 已在工作区完成，只需纳入 CI（ENG-1）。
5. ENG-1 `justfile` + CI（把已有的 `tests/docs.test.js` 一并纳入）。

**第二波（规模可用性，3–5 天）**
6. PERF-1 占用索引重构 + `tests/performance.test.js` 基线（与 PERF-2 联动）。
7. PERF-4 HUD 脏标记/节流 + 满意度直方图。
8. PERF-5 引导顺序、gzip、按章懒加载、favicon。
9. CONS-4 服务端试玩门禁（或明确降级文档）。
10. ENG-3 `game.js` 拆分与单测。

**第三波（玩法深度，按设计决策排期）**
11. SIM-1 道路等级取舍（需要产品决策：养护费 / 结构限制 / 收益递减）。
12. SIM-3 需求曲线（服务 2.5 配时教学）。
13. SIM-2 单向道（核心有向边改造，需单独立项）。
14. SIM-4 公交运营成本与专用道；SIM-5 第四章「慢行优先」。
15. CONS-8 星级与时限梯度统一（同时重跑全部关卡测试与参考链）。

**需要用户决策的问题**（建议在动手前确认）
- SIM-1 用哪种约束（养护成本 / 出口等级限制 / 收益递减）？这会改变现有 17 关的参考解与星级，属于平衡性变更。
- SIM-2 若实现有向边，是否接受存档升到 v9 并承担核心重构？
- CONS-3 是把预设/默认配置做成面板功能，还是降级为 API 并改文档？
- CONS-4 是否要求服务端强制试玩门禁（会让「直接调 API 发布」不再可行）？

---

## 7. 值得保留、不要回退的部分

- 确定性模拟：核心无 `Math.random`、无墙钟依赖，`step(0.05)` 可复现，201 个测试覆盖人口守恒、容量、车道预约、冲突区、存档往返与属性测试。
- 零依赖、无构建、无外部 CDN；核心层与 DOM 完全解耦（浏览器/Node 双导出）。
- 服务端安全基线扎实：只读白名单、GET/HEAD、CSP/X-Frame-Options/nosniff、ETag、头部与连接限制；管理员端密码必需、恒定时间比较、登录限流、默认回环绑定。
- 管理员侧的结构化校验 + 参考答案链自动验证 + 试玩门禁（在前端有效）思路很好；`level-validation.js` 的错误定位（章节/关卡/字段/格子）值得继续沿用。
- 玩家侧的知情提示体系（规划提示、`!` 标记、运营前检查、人口守恒、星级与个人最佳）与 `prefers-reduced-motion` 支持；路线使用符号而非仅靠颜色区分。

---

## 附录 A：性能实测脚本（可复现）

以下脚本已用于 PERF-1/PERF-2 的数字，放在项目外（例如 `/tmp/bench.js`）执行：`node /tmp/bench.js`（路径按需改）。

```js
const core = require('/path/to/traffic_game/src/shared/core.js');
function makeLevel(rowCount, seconds, W, H) {
  const routes = [], roads = [], edges = [];
  for (let i = 0; i < rowCount; i++) {
    const y = i * Math.floor(H / rowCount) + 1, base = y * W;
    routes.push({ name: 'r' + i, color: '#638d69', light: '#dae6cb',
      homes: [{ cell: base, generationRate: 4, passengers: 600 }],
      goals: [{ cell: base + W - 1, label: 'g' }] });
    for (let x = 1; x <= W - 2; x++) roads.push({ cell: base + x, grade: 2 }); // grade 2 = 快速路
    edges.push([base, base + 1]);
    for (let x = 1; x < W - 2; x++) edges.push([base + x, base + x + 1]);
    edges.push([base + W - 2, base + W - 1]);
  }
  return { version: 1, chapters: [{ id: 'bench', name: 'b', english: 'b', levels: [{
    id: 'bench', name: 'b', english: 'b', difficulty: 'd', title: 't', description: 'd', tip: 't', lesson: 'l',
    budget: 100000, duration: 100000, busLineLimit: 1, starTargets: { satisfaction: 50, efficiency: { maxCost: 1000, maxQueue: 1000 } },
    features: { grade: true, load: true, cut: true, inspect: true, signals: false, bus: false },
    width: W, height: H, water: [], bridges: [], trees: [], version: 2, initialRoads: roads, initialEdges: edges, routes }] }] };
}
function bench(rowCount, W = 64, H = 64, seconds = 20) {
  core.setLevels(makeLevel(rowCount, seconds, W, H));
  const city = new core.City('bench'); city.toggle();
  const until = city.elapsed + seconds;
  while (city.elapsed < until && city.state === 'running') city.step(0.05);
  const t0 = process.hrtime.bigint(); let steps = 0;
  for (let i = 0; i < 20; i++) { city.step(0.05); steps++; }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${rowCount} corridors | cars=${city.cars.length} perStep=${(ms / steps).toFixed(2)}ms`);
}
bench(15); bench(30); bench(60);
```

调用计数版本在 `City.prototype` 的 `occupants/laneFor/load/reservations/planCarPath` 上加计数器即可；检查器寻路成本用 `for (let i = 0; i < 200; i++) city.homeTravelInfo(0)` 计时。

所有实测都只用公开 API（`core.setLevels` + `new City` + `step`），不改动仓库文件，也不写入运行时产物。

## 附录 B：本次使用过的核对命令

```sh
node --test tests/*.test.js                       # 201 pass / 0 fail / ~31 s
node -e "require('./src/shared/level-catalog.js').loadCatalogSync(require('node:path').resolve('built-in-levels.json'))"
diff -rq levels levels.local                      # 暴露 3 个 campaign 关卡漂移
curl -s --noproxy '*' http://127.0.0.1:8180/levels.json
curl -s --noproxy '*' http://127.0.0.1:8180/levels.local/road-basics/growing-city.json
git log -1 --format='%h %s'                       # 基线 8d68fd6
```
