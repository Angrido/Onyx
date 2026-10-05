#!/usr/bin/env bash
set -euo pipefail

AGENT_USER="${AGENT_USER:-onyx-agent}"
AGENT_GROUP="${AGENT_GROUP:-onyx-work}"
SERVICE_USER="${SERVICE_USER:-onyx}"
PROJECTS_DIR="${PROJECTS_DIR:-/srv/onyx/projects}"
DATA_DIR="${DATA_DIR:-/var/lib/onyx}"
RELEASES_DIR="${RELEASES_DIR:-/opt/onyx}"
ENV_FILE="${ENV_FILE:-/etc/onyx/onyx.env}"
ENABLE=false

for argument in "$@"; do
  case "$argument" in
    --enable) ENABLE=true ;;
    *)
      printf 'usage: agent-sandbox.sh [--enable]\n' >&2
      exit 2
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  printf 'agent-sandbox.sh must run as root\n' >&2
  exit 1
fi

if ! getent group "$AGENT_GROUP" >/dev/null; then
  groupadd --system "$AGENT_GROUP"
fi
if ! id "$AGENT_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$AGENT_USER" --gid "$AGENT_GROUP" --shell /bin/bash "$AGENT_USER"
fi
usermod --append --groups "$AGENT_GROUP" "$SERVICE_USER"
AGENT_HOME="$(getent passwd "$AGENT_USER" | cut -d: -f6)"
install -d -o "$AGENT_USER" -g "$AGENT_GROUP" -m 700 "$AGENT_HOME"
if [ ! -f "$AGENT_HOME/.claude.json" ]; then
  printf '{"hasCompletedOnboarding":true}\n' >"$AGENT_HOME/.claude.json"
  chown "$AGENT_USER:$AGENT_GROUP" "$AGENT_HOME/.claude.json"
  chmod 600 "$AGENT_HOME/.claude.json"
fi

SUDOERS="/etc/sudoers.d/onyx-agent"
cat >"$SUDOERS.tmp" <<EOF
Defaults:$SERVICE_USER !use_pty
$SERVICE_USER ALL=($AGENT_USER) NOPASSWD:SETENV: ALL
EOF
chmod 440 "$SUDOERS.tmp"
visudo -cf "$SUDOERS.tmp" >/dev/null
mv "$SUDOERS.tmp" "$SUDOERS"

install -d -m 755 /etc/systemd/system/onyx-api.service.d
cat >/etc/systemd/system/onyx-api.service.d/agent-sandbox.conf <<EOF
[Service]
NoNewPrivileges=false
SupplementaryGroups=$AGENT_GROUP
EOF

share_tree() {
  local root="$1"
  [ -d "$root" ] || return 0
  chgrp -R "$AGENT_GROUP" "$root"
  find "$root" -name .git -prune -o -type d -exec chmod g+rwxs {} +
  find "$root" -name .git -prune -o ! -type d ! -type l -exec chmod g+rw {} +
  find "$root" -name .git -exec chmod -R g+rX,g-w {} +
}

install -d -o "$SERVICE_USER" -g "$AGENT_GROUP" -m 2770 "$PROJECTS_DIR"
share_tree "$PROJECTS_DIR"
chgrp "$AGENT_GROUP" "$DATA_DIR"
chmod 710 "$DATA_DIR"
install -d -o "$SERVICE_USER" -g "$AGENT_GROUP" -m 2750 "$DATA_DIR/runtime" "$DATA_DIR/runtime/tdd"
install -d -o "$SERVICE_USER" -g "$AGENT_GROUP" -m 2770 "$DATA_DIR/worktrees"
share_tree "$DATA_DIR/worktrees"

if [ -d "$RELEASES_DIR" ]; then
  chmod o+x "$RELEASES_DIR" "$RELEASES_DIR/releases" 2>/dev/null || true
  for release in "$RELEASES_DIR"/releases/*/; do
    [ -d "$release/mcp" ] || continue
    chmod o+x "$release"
    chgrp -R "$AGENT_GROUP" "$release/mcp"
    chmod -R g+rX "$release/mcp"
  done
fi

CLAUDE="$(runuser -u "$SERVICE_USER" -- bash -lc 'command -v claude' 2>/dev/null || true)"
if [ -n "$CLAUDE" ]; then
  SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
  for path in "$CLAUDE" "$(readlink -f "$CLAUDE")"; do
    chgrp -h "$AGENT_GROUP" "$path" 2>/dev/null || true
    chmod g+rx "$(readlink -f "$path")"
    directory="$(dirname "$path")"
    while [ "$directory" != "/" ] && [ "${directory#"$SERVICE_HOME"}" != "$directory" ]; do
      chgrp "$AGENT_GROUP" "$directory"
      chmod g+x "$directory"
      directory="$(dirname "$directory")"
    done
  done
else
  printf 'warning: claude not found for %s: agents need read access to the Claude Code binary\n' "$SERVICE_USER" >&2
fi

if $ENABLE; then
  if grep -q '^ONYX_AGENT_USER=' "$ENV_FILE"; then
    sed -i "s/^ONYX_AGENT_USER=.*/ONYX_AGENT_USER=$AGENT_USER/" "$ENV_FILE"
  else
    printf '\nONYX_AGENT_USER=%s\nONYX_AGENT_GROUP=%s\n' "$AGENT_USER" "$AGENT_GROUP" >>"$ENV_FILE"
  fi
  systemctl daemon-reload
  systemctl restart onyx-api.service
  printf 'Agents now run as %s. Check Settings or /api/ready for "agent-sandbox".\n' "$AGENT_USER"
else
  systemctl daemon-reload
  printf 'Ready. Add ONYX_AGENT_USER=%s to %s and restart onyx-api, or run again with --enable.\n' "$AGENT_USER" "$ENV_FILE"
fi
