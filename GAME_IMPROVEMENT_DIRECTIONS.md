# 慢行小城：改进路线图索引

本文件仅作为改进条目的索引。每个条目的现状、计划和验收标准分别维护在 [`docs/improvements/`](docs/improvements/) 下；证据、影响分析和复现实测统一见 [`dsim.md`](dsim.md)。

## 状态说明

- ✅ 已完成
- 🟡 进行中
- ⬜ 待实施
- ⏸ 暂缓

## P0：恢复与保留玩家进度

| 条目 | 状态 | 详情 |
| --- | --- | --- |
| 完整的“继续游戏”能力 | ✅ | [p0-progress.md](docs/improvements/p0-progress.md) |
| 情境式新手引导 | ✅ | [p0-onboarding.md](docs/improvements/p0-onboarding.md) |
| 文档一致性修复 | ✅ | [p0-doc-consistency.md](docs/improvements/p0-doc-consistency.md) |

## P1：加强推进感与复盘价值

| 条目 | 状态 | 详情 |
| --- | --- | --- |
| 推荐游玩路径 | ✅（已实现） | 项目历史实现，暂无独立待改进条目 |
| 地图化失败复盘 | ✅ | [p1-replay.md](docs/improvements/p1-replay.md) |
| 沙盒实验能力 | ⬜ | [p1-sandbox.md](docs/improvements/p1-sandbox.md) |
| 设计导入、导出与分享 | ⬜ | [p1-design-sharing.md](docs/improvements/p1-design-sharing.md) |

## P2：扩展长期可玩性

| 条目 | 状态 | 详情 |
| --- | --- | --- |
| 确定性挑战变体 | ⬜ | [p2-challenge-variants.md](docs/improvements/p2-challenge-variants.md) |
| 五日扩建的策略分支 | ⬜ | [p2-expansion-branches.md](docs/improvements/p2-expansion-branches.md) |
| 可选声音与视觉主题 | ⏸ | [p2-themes.md](docs/improvements/p2-themes.md) |

## 技术路线

| 条目 | 状态 | 详情 |
| --- | --- | --- |
| 降低空闲渲染与大地图开销 | ⬜ | [tech-rendering.md](docs/improvements/tech-rendering.md) |
| 继续拆分玩家端主模块 | ⬜ | [tech-game-modules.md](docs/improvements/tech-game-modules.md) |
| 减少规则文案重复 | ⬜ | [tech-copy.md](docs/improvements/tech-copy.md) |

## 通用测试与发布要求

每项改进都必须：

1. 同步更新受影响的 README、玩家指南和管理员手册。
2. 修改关卡、预算、需求或交通规则后运行完整 Node 测试并验证参考方案。
3. 涉及浏览器界面、存档或 CSP 时运行对应的浏览器/UI 冒烟测试。
4. 为存档变化提供版本、严格校验、原子加载和迁移测试。
5. 完成功能后更新对应条目文件的状态；部分实现标记为 🟡 并写明剩余验收项。

## 建议实施顺序

1. 地图化失败复盘
2. 沙盒复制与实验参数
3. 设计导入/导出
4. 静止渲染和大地图无障碍优化
5. 确定性挑战变体与五日策略分支

## dsim 审计条目

以下条目来自另一份独立审计，按问题点单独维护。详细证据和原始实测见 [dsim.md](dsim.md)。

| 编号 | 优先级 | 状态 | 条目 |
| --- | --- | --- | --- |
| CONS-1 | P0 | ⬜ | [发布覆盖与内置关卡漂移，且测试只覆盖内置关卡](docs/improvements/audit/cons-1.md) |
| CONS-2 | — | ✅ | [README 快捷键与真实按键不一致](docs/improvements/audit/cons-2.md) |
| CONS-3 | P1 | ⬜ | [README 宣称的「另存为配置 / 覆盖默认配置」在面板没有入口](docs/improvements/audit/cons-3.md) |
| CONS-4 | P1 | ⬜ | [「人工试玩」门禁只在前端](docs/improvements/audit/cons-4.md) |
| CONS-5 | — | ✅ | [`AGENTS.md` 引用了已删除的改进文档](docs/improvements/audit/cons-5.md) |
| CONS-6 | P2 | ⬜ | [观察模式下按空格给出误导提示](docs/improvements/audit/cons-6.md) |
| CONS-7 | P2 | ⬜ | [死代码与遗留开关](docs/improvements/audit/cons-7.md) |
| CONS-8 | P2 | ⬜ | [星级阈值与教学时限缺少一致梯度](docs/improvements/audit/cons-8.md) |
| CONS-9 | P2 | ⬜ | [8–64 地图能力没有真实使用](docs/improvements/audit/cons-9.md) |
| PERF-1 | P0 | ⬜ | [`occupants()` 是 O(车辆数)，并把 `step()` 与寻路拖成 O(V²)](docs/improvements/audit/perf-1.md) |
| PERF-2 | P0 | ⬜ | [选中住宅时每帧执行两次完整寻路](docs/improvements/audit/perf-2.md) |
| PERF-3 | P1 | ⬜ | [无障碍网格既不可达又昂贵](docs/improvements/audit/perf-3.md) |
| PERF-4 | P1 | ⬜ | [每帧无条件更新界面](docs/improvements/audit/perf-4.md) |
| PERF-5 | P1 | ⬜ | [启动拉取两套关卡清单，且无压缩](docs/improvements/audit/perf-5.md) |
| PERF-6 | P2 | ⬜ | [∞× 管理员模式同步空转](docs/improvements/audit/perf-6.md) |
| SIM-1 | P1 | ⬜ | [道路等级缺乏取舍，「越快越好」没有代价](docs/improvements/audit/sim-1.md) |
| SIM-2 | P1 | ⬜ | [没有单向道与环岛](docs/improvements/audit/sim-2.md) |
| SIM-3 | P1 | ⬜ | [没有分时段需求曲线](docs/improvements/audit/sim-3.md) |
| SIM-4 | P2 | ⬜ | [公交缺少运营成本与专用道](docs/improvements/audit/sim-4.md) |
| SIM-5 | P2 | ⬜ | [「慢行」主题缺失](docs/improvements/audit/sim-5.md) |
| SIM-6 | P2 | ⬜ | [没有进度持久化，玩家体验割裂](docs/improvements/audit/sim-6.md) |
| SIM-7 | P2 | ⬜ | [存档无法导出、导入或分享](docs/improvements/audit/sim-7.md) |
| SIM-8 | P2 | ⬜ | [没有声音与暗色主题](docs/improvements/audit/sim-8.md) |
| A11Y-1 | P1 | ⬜ | [键盘光标移出视口后地图不跟随](docs/improvements/audit/a11y-1.md) |
| A11Y-2 | P1 | ⬜ | [ARIA 网格不可达且结构无效](docs/improvements/audit/a11y-2.md) |
| A11Y-3 | P2 | ⬜ | [画布禁止页面缩放、文字最小 8–10 px](docs/improvements/audit/a11y-3.md) |
| A11Y-4 | P2 | ⬜ | [画布 `aria-label` 不随模式更新](docs/improvements/audit/a11y-4.md) |
| ENG-1 | P1 | ⬜ | [没有 CI，也没有统一命令入口](docs/improvements/audit/eng-1.md) |
| ENG-2 | P1 | ⬜ | [浏览器冒烟测试长期处于「可选且易失效」状态](docs/improvements/audit/eng-2.md) |
| ENG-3 | P1 | ⬜ | [`game.js`（1457 行）没有单元测试](docs/improvements/audit/eng-3.md) |
| ENG-4 | P2 | ⬜ | [管理员页面注入依赖精确字符串](docs/improvements/audit/eng-4.md) |
| ENG-5 | P2 | ⬜ | [关卡格式没有文档化 schema](docs/improvements/audit/eng-5.md) |
| ENG-6 | P2 | ⬜ | [细节打磨](docs/improvements/audit/eng-6.md) |
