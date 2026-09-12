# ENG-1：没有 CI，也没有统一命令入口

- 来源：[`dsim.md`](../../../dsim.md)
- 优先级：P1
- 状态：⬜ 待实施

- **现象**：仓库无 `.github/`、无 `package.json`、无 Makefile/justfile；`AGENTS.md` 用 10 条 `node --check` + `node --test` 手工列出检查项。
- **影响**：201 个测试全靠人工记忆执行；本机（Nix + `just`）与协作者环境不一致时容易漏跑。
- **建议**：加 `justfile`（`just check` / `just test` / `just serve` / `just bench`）或 `scripts/check.sh`，再加一个零依赖的 GitHub Actions 工作流（`actions/setup-node` + 上述脚本）；可选 job 安装 Chromium 跑 `tests/*.cjs`。不引入 npm 依赖，保持无构建。
- **验收**：CI 上 `just check` 全绿；README 的「开发与测试」改为指向该入口。
