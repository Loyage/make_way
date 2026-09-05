# 服务部署与远程访问

## 本次部署状态

- 已安装并启用 `~/.config/systemd/user/traffic-game.service`，当前正在运行。
- 监听 `[::]:8180`，同时接受所有网卡上的 IPv4 和 IPv6 连接。
- 已通过 `127.0.0.1`、`::1` 和本机网卡地址的 HTTP 健康检查。
- 本次检测到的 IPv4 是 **`183.173.175.128`**；这是当前网卡地址，不保证固定或可从互联网直接访问。
- **按你的选择，未执行 NixOS 重建，未修改现有防火墙，也未启用 linger。**
- **目前远程访问仍受本机防火墙阻挡。** 服务已启用，但 `Linger=no`，未完成“重启后无需登录即运行”；当前会随用户管理器启动，退出所有登录后也可能停止。
- `~/nix-config` 原有修改未作改动。此目录下的 `traffic-game-network.nix` 是待应用配置，并未安装到系统配置仓库。

本机现在可以访问：<http://127.0.0.1:8180>。

完成防火墙和网络配置后，其他设备可尝试访问：**`http://183.173.175.128:8180`**。

## 1. 安装或更新用户服务

在游戏项目目录运行：

```sh
bash deploy/install-service.sh
```

脚本仅安装、启用和重启当前用户的 `traffic-game.service`，不修改系统防火墙，不请求 sudo，不安装软件包。服务以普通用户身份运行，设置了只读文件系统、临时目录隔离、禁止提权和内存上限。

需要已安装 Node.js 18+。这台机器通过 Nix 管理 Node.js；如果更换项目路径或 Node 的可执行路径，重新运行安装脚本。

## 2. 稍后应用 NixOS 网络与开机配置

准备好的 `traffic-game-network.nix` 包含：

```nix
{ myvars, ... }:
{
  networking.firewall.allowedTCPPorts = [ 8180 ];
  users.users.${myvars.username}.linger = true;
}
```

`modules/linux/` 会自动导入其中的 `.nix` 文件。**先检查配置仓库的现有修改，确认可以一并应用，再执行以下命令。** 不覆盖同名已有模块：

```sh
cd ~/nix-config
if test -e modules/linux/traffic-game.nix; then
  echo '同名模块已存在，请先检查内容。'
else
  cp ~/Documents/traffic_game/deploy/traffic-game-network.nix modules/linux/traffic-game.nix &&
  git add modules/linux/traffic-game.nix &&
  just switch
fi
```

这会持久放行 TCP 8180，并允许当前已启用的用户服务开机即启动、退出登录后继续运行。端口和 linger 都由 NixOS 声明式管理，不需要额外手工修改 iptables。

应用后检查：

```sh
loginctl show-user "$USER" -p Linger
systemctl --user is-enabled traffic-game.service
systemctl --user is-active traffic-game.service
ss -ltn '( sport = :8180 )'
curl --noproxy '*' http://127.0.0.1:8180/healthz
```

应分别看到 `Linger=yes`、`enabled`、`active`、8180 监听以及 `{"status":"ok"}`。

## 3. 从远程设备验证网络

请在**另一台设备**，最好再用不同网络或手机蜂窝数据，访问：

```text
http://183.173.175.128:8180
```

或在远程机器执行：

```sh
curl --connect-timeout 5 http://183.173.175.128:8180/healthz
```

本机访问自己的网卡 IP 成功，不代表已经通过了远程连通测试。部署时未进行真正的外部网络验证。

如果放行本机端口后仍不通：

1. 用 `ip -brief address` 确认当前 IP，地址可能因重新连接 Wi-Fi 而变化。
2. 家用路由器后面通常需要将公网 TCP 8180 转发到本机 TCP 8180，并固定本机局域网地址。
3. 云主机需要在云安全组中放行入站 TCP 8180。
4. 校园网、单位网络、运营商 CGNAT 或上游防火墙可能禁止外部入站；这无法仅靠本机服务解除，需要网络管理员配合或部署到可公网访问的 VPS。
5. IPv6 使用 `http://[IPv6地址]:8180` 格式，访问者也须具有 IPv6 连通性，上游 IPv6 防火墙同样需要允许。
6. 服务器必须保持开机、联网、未休眠；linger 不会阻止笔记本休眠。

## 日常管理

```sh
systemctl --user status traffic-game.service
systemctl --user restart traffic-game.service
journalctl --user -u traffic-game.service -n 50 --no-pager
systemctl --user stop traffic-game.service
```

服务在启动时将白名单资源读入内存，**更新游戏代码后需要重启服务**；浏览器会通过 ETag 重新验证资源。

默认端口在安装脚本生成的 unit 中设置为 8180。如需长期更换，修改脚本中的 `Environment=PORT=...` 后重新安装，同时同步更新 NixOS 放行端口。不要同时在同一端口启动 `node server.js`。

## 安全与运行范围

- 仅提供 `index.html`、`style.css`、`levels.js`、`core.js`、`game.js` 和 `/healthz`。
- 没有目录浏览，不提供源码仓库中的部署脚本、测试、服务器文件或家庭目录文件。
- 仅接受 GET / HEAD，带安全响应头、请求超时、连接数与内存上限。
- 每位玩家的模拟都在自己的浏览器执行；服务器没有账户、Cookie、共享对局或成绩写入接口。
- 当前是明文 HTTP 的小型静态服务，不是抗大规模攻击的托管平台。若长期面向公网或访问量增大，建议放到 VPS，并使用 Caddy / Nginx 提供 HTTPS 和进一步的连接限流。

## 卸载

```sh
systemctl --user disable --now traffic-game.service
rm ~/.config/systemd/user/traffic-game.service
systemctl --user daemon-reload
```

如果之后应用了网络模块，删除 `~/nix-config/modules/linux/traffic-game.nix` 后再执行 `just switch`，即可移除这份模块所声明的端口放行；如果其他模块也开放该端口，以合并配置为准。

注意：NixOS 的 `linger` 默认值是“不管理”，单纯删除模块不会清除已启用的 linger。若确认其他用户服务也不需要退出登录后继续运行，应先把该模块的端口列表改为 `[]`、`linger` 改为 `false` 并执行 `just switch`，然后再移除模块。
