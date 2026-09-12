# SIM-2：没有单向道与环岛

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P1
- 状态：⬜ 待实施

- **现象**：`City.edges` 为无向邻接（`addEdge`/`removeEdge` 对称），`cut()` 只能整条删除连接；道路引导只有「偏好 / 汽车禁行」（`setRoadPolicy`），没有方向性。
- **影响**：单向道、单行循环、环岛是交通规划题材最经典的三类工具，也是「用最少资源疏解路口」的主要手段；目前玩家只能靠升级道路和调信号。
- **建议**：把 `edges` 升级为有向（或增加 `oneWay: Map<cell, heading>`），需要同步修改：`refreshPaths()`/`findCarPath`、`laneFor`、建筑出口连接、公交线路合法性校验（`busUsesEdge`）、剪断工具、存档 v9 迁移与 `level-validation.js`。工作量较大，建议单独立项。
- **验收**：新增 `tests/oneway.test.js`（逆行车不能通行、存档往返、参考规划器兼容）；`tests/connections.test.js` 扩展剪断/连接用例。
