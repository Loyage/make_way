#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node)"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
# Escape systemd quoted values, including specifiers in file paths.
escape_unit() {
  local value="$1"
  value="${value//\\/\\\\}"; value="${value//\"/\\\"}"; value="${value//%/%%}"
  printf '%s' "$value"
}
mkdir -p "$CONFIG"
cat > "$CONFIG/traffic-game.service" <<EOF
[Unit]
Description=Make Way traffic planning game
After=network.target

[Service]
Type=simple
ExecStart="$(escape_unit "$NODE")" "$(escape_unit "$ROOT/server.js")"
Environment=HOST=::
Environment=PORT=8180
Restart=on-failure
RestartSec=3
TimeoutStopSec=6
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UMask=0077
MemoryMax=192M
TasksMax=32

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable traffic-game.service
systemctl --user restart traffic-game.service
systemctl --user --no-pager status traffic-game.service
printf '\nService installed. Health check: curl --noproxy "*" http://127.0.0.1:8180/healthz\n'
printf 'Firewall and boot-without-login configuration are separate; see deploy/README.md.\n'
