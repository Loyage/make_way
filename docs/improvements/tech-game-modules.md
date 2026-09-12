# 技术：继续拆分玩家端主模块

**状态：⬜ 待实施**

`src/game/game.js` 已承担状态、输入、Canvas 绘制协调、存档、关卡导航、公交、信号、结算和管理员桥接等多种职责。

## 建议拆分

- `game-input.js`：鼠标、触摸和键盘操作。
- `game-storage.js`：进度、设计、星级与迁移。
- `game-navigation.js`：章节、关卡和五日进度。
- `game-inspector.js`：道路、信号和公交检查器。

模拟规则继续位于 `src/shared/`，模块不得反向访问 DOM。每次拆分必须保持脚本加载顺序、游戏服务器白名单和 Node/浏览器测试同步更新。
