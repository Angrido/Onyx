#!/usr/bin/env bash
set -euo pipefail

SOURCE="${1:?usage: release.sh <staged-release-dir> [version]}"
VERSION="${2:-$(cat "$SOURCE/REVISION" 2>/dev/null || date +%Y%m%d%H%M%S)-$(date +%Y%m%d%H%M%S)}"
BASE=/opt/onyx
TARGET="$BASE/releases/$VERSION"

if [ "$(id -u)" -ne 0 ]; then
  printf 'release.sh must run as root\n' >&2
  exit 1
fi

install -d -o root -g onyx -m 750 "$BASE/releases"
cp -a "$SOURCE" "$TARGET"
chown -R root:onyx "$TARGET"
chmod -R g+rX,o-rwx "$TARGET"
if getent group onyx-work >/dev/null && [ -d "$TARGET/mcp" ]; then
  chmod o+x "$BASE" "$BASE/releases" "$TARGET"
  chgrp -R onyx-work "$TARGET/mcp"
  chmod -R g+rX "$TARGET/mcp"
fi

set -a
. /etc/onyx/onyx.env
set +a

was_running=false
if systemctl is-active --quiet onyx-api.service || systemctl is-active --quiet onyx-web.service; then
  was_running=true
  systemctl stop onyx-web.service onyx-api.service
fi

restart_previous() {
  if $was_running; then
    printf 'error: the update failed: starting the previous release again\n' >&2
    systemctl start onyx-api.service onyx-web.service || true
  fi
}
trap restart_previous ERR

install -d -o onyx -g onyx -m 700 "${ONYX_BACKUP_DIR:-/var/backups/onyx}"
runuser -u onyx -- bash -c 'set -a; . /etc/onyx/onyx.env; set +a; exec node "$1/api/dist/cli.js" migrate --prisma-dir "$1/db"' onyx-cli "$TARGET"
trap - ERR

ln -sfn "$TARGET" "$BASE/current"
install -m 644 "$TARGET"/deploy/systemd/*.service /etc/systemd/system/
if [ -f /etc/systemd/system/onyx-backup.timer ]; then
  systemctl disable --now onyx-backup.timer 2>/dev/null || true
  rm -f /etc/systemd/system/onyx-backup.timer /etc/systemd/system/onyx-backup.service
fi
systemctl daemon-reload
systemctl restart onyx-api.service onyx-web.service

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:4000/api/health; then
    break
  fi
  sleep 1
done

curl -sS http://127.0.0.1:4000/api/ready
printf '\nReleased %s\n' "$VERSION"
