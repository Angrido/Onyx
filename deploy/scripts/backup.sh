#!/usr/bin/env bash
set -euo pipefail

set -a
. /etc/onyx/onyx.env
set +a

DATABASE_FILE="${DATABASE_URL#file:}"
DESTINATION="${ONYX_BACKUP_DIR:-/var/backups/onyx}"
KEEP="${ONYX_BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

install -d -m 700 "$DESTINATION"
sqlite3 "$DATABASE_FILE" ".backup '$DESTINATION/onyx-$STAMP.db'"
sqlite3 "$DESTINATION/onyx-$STAMP.db" "PRAGMA integrity_check;" | grep -qx ok

find "$DESTINATION" -maxdepth 1 -name 'onyx-*.db' -printf '%T@ %p\n' \
  | sort -rn \
  | tail -n +"$((KEEP + 1))" \
  | cut -d' ' -f2- \
  | xargs -r rm -f

printf 'Backup written to %s/onyx-%s.db\n' "$DESTINATION" "$STAMP"
