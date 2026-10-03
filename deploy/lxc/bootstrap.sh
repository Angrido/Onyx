#!/usr/bin/env bash
set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-22}"
TIMEZONE="${TIMEZONE:-Europe/Rome}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  printf 'bootstrap.sh must run as root inside the container\n' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get full-upgrade -y
apt-get install -y ca-certificates curl gnupg git build-essential python3 sqlite3 caddy nftables locales

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -q "^v${NODE_MAJOR}\."; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
fi
corepack enable

timedatectl set-timezone "$TIMEZONE" 2>/dev/null || ln -sf "/usr/share/zoneinfo/$TIMEZONE" /etc/localtime

if ! id onyx >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/onyx --shell /bin/bash onyx
fi

install -d -o onyx -g onyx -m 750 /srv/onyx /srv/onyx/projects
install -d -o onyx -g onyx -m 700 /var/lib/onyx /var/lib/onyx/runtime /var/lib/onyx/cache
install -d -o root -g onyx -m 750 /etc/onyx /opt/onyx /opt/onyx/releases
install -d -o root -g root -m 700 /var/backups/onyx

if [ ! -f /etc/onyx/onyx.env ]; then
  install -o root -g onyx -m 640 "$REPO_DIR/deploy/env/onyx.env.example" /etc/onyx/onyx.env
fi

install -m 644 "$REPO_DIR"/deploy/systemd/*.service "$REPO_DIR"/deploy/systemd/*.timer /etc/systemd/system/
install -m 644 "$REPO_DIR/deploy/caddy/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable onyx-api.service onyx-web.service onyx-backup.timer
systemctl reload-or-restart caddy

if ! runuser -u onyx -- bash -lc 'command -v claude' >/dev/null 2>&1; then
  runuser -u onyx -- bash -lc 'curl -fsSL https://claude.ai/install.sh | bash'
fi

printf '\nNext steps:\n'
printf '  1. Edit /etc/onyx/onyx.env (credentials, ONYX_PUBLIC_ORIGIN).\n'
printf '  2. Review deploy/nftables/nftables.conf, then copy it to /etc/nftables.conf and enable nftables.\n'
printf '  3. Run deploy/scripts/build.sh and deploy/scripts/release.sh <release-dir>.\n'
