#!/usr/bin/env bash
set -euo pipefail

TIMEZONE="${TIMEZONE:-Europe/Rome}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  printf 'bootstrap.sh must run as root inside the container\n' >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get full-upgrade -y
apt-get install -y ca-certificates curl gnupg git build-essential python3 sqlite3 caddy nftables locales avahi-daemon libnss-mdns

"$REPO_DIR/scripts/install.sh" --tools-only

timedatectl set-timezone "$TIMEZONE" 2>/dev/null || ln -sf "/usr/share/zoneinfo/$TIMEZONE" /etc/localtime

if ! id onyx >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/onyx --shell /bin/bash onyx
fi

install -d -o onyx -g onyx -m 750 /srv/onyx /srv/onyx/projects
install -d -o onyx -g onyx -m 700 /var/lib/onyx /var/lib/onyx/runtime /var/lib/onyx/cache
install -d -o root -g onyx -m 750 /etc/onyx /opt/onyx /opt/onyx/releases
install -d -o onyx -g onyx -m 700 /var/backups/onyx

if [ ! -f /etc/onyx/onyx.env ]; then
  install -o root -g onyx -m 640 "$REPO_DIR/deploy/env/onyx.env.example" /etc/onyx/onyx.env
fi

install -m 644 "$REPO_DIR"/deploy/systemd/*.service /etc/systemd/system/
install -m 644 "$REPO_DIR/deploy/caddy/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable onyx-api.service onyx-web.service
systemctl reload-or-restart caddy

if [ -f /etc/avahi/avahi-daemon.conf ]; then
  sed -i '/^rlimit-nproc=/d' /etc/avahi/avahi-daemon.conf
fi
install -m 644 "$REPO_DIR/deploy/avahi/onyx.service" /etc/avahi/services/onyx.service
systemctl enable avahi-daemon.service
systemctl restart avahi-daemon.service || printf 'avahi-daemon could not start: onyx.local will not be advertised\n' >&2

if ! runuser -u onyx -- bash -lc 'command -v claude' >/dev/null 2>&1; then
  runuser -u onyx -- bash -lc 'curl -fsSL https://claude.ai/install.sh | bash'
fi

ONYX_MODE=service "$REPO_DIR/scripts/onyx" install

printf '\nNext steps:\n'
printf '  1. Edit /etc/onyx/onyx.env (Claude credentials).\n'
printf '  2. Review deploy/nftables/nftables.conf, then copy it to /etc/nftables.conf and enable nftables.\n'
printf '  3. Run onyx-update to build and install the first release (later runs update it).\n'
printf '\nOnce released, Onyx answers on every interface through Caddy:\n'
for address in $(hostname -I 2>/dev/null); do
  case "$address" in
    *:*) printf '  http://[%s]\n' "$address" ;;
    *) printf '  http://%s\n' "$address" ;;
  esac
done
printf '  http://%s.local\n' "$(hostname)"
