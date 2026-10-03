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

set -a
. /etc/onyx/onyx.env
set +a

(cd "$TARGET/db" && runuser -u onyx -- env DATABASE_URL="$DATABASE_URL" ./node_modules/.bin/prisma migrate deploy)

ln -sfn "$TARGET" "$BASE/current"
install -m 644 "$TARGET"/deploy/systemd/*.service "$TARGET"/deploy/systemd/*.timer /etc/systemd/system/
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
