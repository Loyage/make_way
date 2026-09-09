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
# Admin password: prefer ADMIN_PASSWORD, then fall back to the local .env file.
PASSWORD="${ADMIN_PASSWORD:-}"
if [[ -f "$ROOT/.env" ]]; then
  source "$ROOT/.env"
  PASSWORD="${PASSWORD:-$ADMIN_PASSWORD}"
fi
if [[ -z "$PASSWORD" || "$PASSWORD" == "admin" ]]; then
  printf 'Refusing to install the network-facing admin panel without a strong ADMIN_PASSWORD.\n' >&2
  printf 'Set ADMIN_PASSWORD in the environment or in %s/.env first.\n' "$ROOT" >&2
  exit 1
fi
mkdir -p "$CONFIG"
cat > "$CONFIG/traffic-game-admin.service" <<EOF
[Unit]
Description=Make Way traffic game admin panel
After=network.target

[Service]
Type=simple
ExecStart="$(escape_unit "$NODE")" "$(escape_unit "$ROOT/admin-server.js")"
Environment=ADMIN_HOST=::
Environment=ADMIN_PORT=8080
Environment=ADMIN_PASSWORD="$(escape_unit "$PASSWORD")"
Restart=on-failure
RestartSec=3
TimeoutStopSec=6
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths="$(escape_unit "$ROOT")"
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
UMask=0077
MemoryMax=192M
TasksMax=32

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable traffic-game-admin.service
systemctl --user restart traffic-game-admin.service
systemctl --user --no-pager status traffic-game-admin.service
printf '\nAdmin service installed. Panel: http://127.0.0.1:8080 (password: %s)\n' "$PASSWORD"
printf 'Panel is bound to all interfaces ([::]:8080); use the password to restrict access.\n'
printf 'Health gate check: curl --noproxy "*" -o /dev/null -w "%%{http_code}\\n" http://127.0.0.1:8080/\n'
printf 'The admin panel writes the levels.json manifest and levels.local/ data; restart traffic-game.service afterwards.\n'
