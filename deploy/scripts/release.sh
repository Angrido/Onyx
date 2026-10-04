#!/usr/bin/env bash
set -euo pipefail

SOURCE="${1:?usage: release.sh <staged-release-dir> [version]}"
STAMP="$(date +%Y%m%d%H%M%S)"
VERSION="${2:-$(cat "$SOURCE/REVISION" 2>/dev/null || printf '%s' "$STAMP")-$STAMP}"
BASE="${ONYX_BASE_DIR:-/opt/onyx}"
RELEASES="$BASE/releases"
CURRENT="$BASE/current"
TARGET="$RELEASES/$VERSION"
PENDING_MARK=.release-pending
ENV_FILE="${ONYX_ENV_FILE:-/etc/onyx/onyx.env}"
UNIT_DIR="${ONYX_UNIT_DIR:-/etc/systemd/system}"
SYSTEMCTL="${ONYX_SYSTEMCTL:-systemctl}"
SERVICE_USER="${ONYX_SERVICE_USER:-onyx}"
HEALTH_URL="${ONYX_HEALTH_URL:-http://127.0.0.1:4000/api/ready}"
HEALTH_ATTEMPTS="${ONYX_HEALTH_ATTEMPTS:-60}"
HEALTH_DELAY="${ONYX_HEALTH_DELAY:-1}"
KEEP_RELEASES="${ONYX_KEEP_RELEASES:-3}"
MACHINE_CHECKS="claude-cli disk"

AS_SELF=false
if [ "${ONYX_RELEASE_AS_SELF:-}" = 1 ]; then
  AS_SELF=true
elif [ "$(id -u)" -ne 0 ]; then
  printf 'release.sh must run as root\n' >&2
  exit 1
fi

say() { printf '%s\n' "$*"; }
error() { printf 'error: %s\n' "$*" >&2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

env_value() {
  [ -r "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\\(.*\\)'\$/\\1/"
}

as_service() {
  if $AS_SELF; then
    "$@"
  else
    runuser -u "$SERVICE_USER" -- "$@"
  fi
}

onyx_cli() {
  local release="$1"
  shift
  as_service bash -c 'set -a; . "$1"; set +a; release="$2"; shift 2; exec node "$release/api/dist/cli.js" "$@"' onyx-cli "$ENV_FILE" "$release" "$@"
}

switch_current() {
  ln -sfn "$1" "$CURRENT.new"
  mv -Tf "$CURRENT.new" "$CURRENT"
}

install_units() {
  local release="$1"
  if compgen -G "$release/deploy/systemd/*.service" >/dev/null; then
    install -m 644 "$release"/deploy/systemd/*.service "$UNIT_DIR/"
  fi
  if [ -f "$UNIT_DIR/onyx-backup.timer" ]; then
    "$SYSTEMCTL" disable --now onyx-backup.timer 2>/dev/null || true
    rm -f "$UNIT_DIR/onyx-backup.timer" "$UNIT_DIR/onyx-backup.service"
  fi
  "$SYSTEMCTL" daemon-reload
}

services_active() {
  "$SYSTEMCTL" is-active --quiet onyx-api.service || "$SYSTEMCTL" is-active --quiet onyx-web.service
}

migration_names() {
  if [ -d "$1/db/prisma/migrations" ]; then
    find "$1/db/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
  fi
}

adds_migrations() {
  [ -n "$PREVIOUS" ] || return 0
  [ -d "$PREVIOUS/db/prisma/migrations" ] || return 0
  [ -n "$(comm -13 <(migration_names "$PREVIOUS") <(migration_names "$TARGET"))" ]
}

ready_now() {
  curl --noproxy '*' -fsS -o /dev/null --max-time 5 "$HEALTH_URL" 2>/dev/null
}

failing_checks() {
  curl --noproxy '*' -sS --max-time 5 "$HEALTH_URL" 2>/dev/null | node -e '
    let text = "";
    process.stdin.on("data", (chunk) => (text += chunk));
    process.stdin.on("end", () => {
      try {
        const body = JSON.parse(text);
        if (!Array.isArray(body.checks)) process.exit(1);
        const failing = body.checks
          .filter((check) => !check.ok && check.name !== "credentials")
          .map((check) => String(check.name));
        process.stdout.write(failing.join(" "));
      } catch {
        process.exit(1);
      }
    });
  '
}

tolerated() {
  local allowed check
  if $BASELINE_KNOWN; then allowed="$BASELINE"; else allowed="$MACHINE_CHECKS"; fi
  [ -n "$1" ] || return 1
  for check in $1; do
    [ "$check" != database ] || return 1
    case " $allowed " in
      *" $check "*) ;;
      *) return 1 ;;
    esac
  done
}

wait_ready() {
  local attempt failing
  NOT_READY="$VERSION does not answer on $HEALTH_URL"
  TOLERATED=""
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if ready_now; then
      return 0
    fi
    if failing="$(failing_checks)"; then
      if tolerated "$failing"; then
        TOLERATED="$failing"
        return 0
      fi
      if [ -n "$failing" ]; then
        NOT_READY="$VERSION is not ready on $HEALTH_URL (failing checks: $failing)"
      else
        NOT_READY="$VERSION did not become ready on $HEALTH_URL"
      fi
    fi
    if [ "$attempt" -lt "$HEALTH_ATTEMPTS" ]; then sleep "$HEALTH_DELAY"; fi
  done
  return 1
}

restore_database() {
  local release
  for release in "$PREVIOUS" "$TARGET"; do
    if [ -f "$release/api/dist/cli.js" ] && onyx_cli "$release" restore "$BACKUP_FILE" --force; then
      return 0
    fi
  done
  return 1
}

rollback() {
  error "$1"
  if [ -z "$PREVIOUS" ]; then
    error "there is no previous release to go back to: $VERSION stays installed; check journalctl -u onyx-api"
    exit 1
  fi
  say "Going back to $(basename "$PREVIOUS")"
  "$SYSTEMCTL" stop onyx-web.service onyx-api.service || true
  switch_current "$PREVIOUS"
  install_units "$PREVIOUS"
  local restored=true
  if $MIGRATED && [ -n "$BACKUP_FILE" ]; then
    say "Putting back the database saved before the migration ($BACKUP_FILE)"
    if ! restore_database; then
      restored=false
      error "the database could not be put back: stop Onyx and run onyx restore $BACKUP_FILE"
    fi
  fi
  if $WAS_RUNNING; then
    "$SYSTEMCTL" start onyx-api.service onyx-web.service || error "the previous release did not start: check journalctl -u onyx-api"
  fi
  rm -rf "$TARGET"
  if $restored; then
    error "the update failed and was undone: $(basename "$PREVIOUS") is the current release again"
  else
    error "the update failed: $(basename "$PREVIOUS") is the current release again, but the database still has the new migrations"
  fi
  exit 1
}

prune_releases() {
  local current_dir kept=1 dir
  current_dir="$(readlink -f "$CURRENT")"
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$current_dir" ] && [ -d "$PREVIOUS" ] && [ ! -e "$PREVIOUS/$PENDING_MARK" ]; then
    kept=2
  fi
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    [ "$dir" != "$current_dir" ] || continue
    if [ "$dir" = "$PREVIOUS" ] && [ ! -e "$dir/$PENDING_MARK" ]; then
      continue
    fi
    if [ -e "$dir/$PENDING_MARK" ] || [ "$kept" -ge "$KEEP_RELEASES" ]; then
      say "Removing release $(basename "$dir")"
      rm -rf "$dir"
    else
      kept=$((kept + 1))
    fi
  done < <(find "$(readlink -f "$RELEASES")" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
}

[ -d "$SOURCE" ] || {
  error "$SOURCE is not a staged release"
  exit 1
}
if [ -e "$TARGET" ]; then
  error "release $VERSION already exists in $RELEASES"
  exit 1
fi

PREVIOUS=""
if [ -L "$CURRENT" ] && [ -d "$(readlink -f "$CURRENT")" ]; then
  PREVIOUS="$(readlink -f "$CURRENT")"
fi

if $AS_SELF; then
  mkdir -p "$RELEASES"
  cp -a "$SOURCE" "$TARGET"
else
  install -d -o root -g onyx -m 750 "$RELEASES"
  cp -a "$SOURCE" "$TARGET"
  chown -R root:onyx "$TARGET"
  chmod -R g+rX,o-rwx "$TARGET"
  if getent group onyx-work >/dev/null && [ -d "$TARGET/mcp" ]; then
    chmod o+x "$BASE" "$RELEASES" "$TARGET"
    chgrp -R onyx-work "$TARGET/mcp"
    chmod -R g+rX "$TARGET/mcp"
  fi
fi
touch "$TARGET/$PENDING_MARK"

BACKUP_DIR="$(env_value ONYX_BACKUP_DIR)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/onyx}"

WAS_RUNNING=false
BASELINE_KNOWN=false
BASELINE=""
if services_active; then
  WAS_RUNNING=true
  if BASELINE="$(failing_checks)"; then BASELINE_KNOWN=true; fi
  "$SYSTEMCTL" stop onyx-web.service onyx-api.service
fi

if $AS_SELF; then
  mkdir -p "$BACKUP_DIR"
else
  install -d -o onyx -g onyx -m 700 "$BACKUP_DIR"
fi

MIGRATED=false
if adds_migrations; then MIGRATED=true; fi
if ! onyx_cli "$TARGET" migrate --prisma-dir "$TARGET/db" | tee "$WORK/migrate.log"; then
  error "the migration failed: the database is as it was before the update"
  rm -rf "$TARGET"
  if $WAS_RUNNING; then
    error "starting the previous release again"
    "$SYSTEMCTL" start onyx-api.service onyx-web.service || true
  fi
  exit 1
fi
BACKUP_FILE="$(sed -n 's/^Backup written before the migration: //p' "$WORK/migrate.log" | tail -n 1)"

switch_current "$TARGET"
install_units "$TARGET"
"$SYSTEMCTL" restart onyx-api.service onyx-web.service || rollback "the services of $VERSION did not start"

wait_ready || rollback "$NOT_READY"
if [ -n "$TOLERATED" ]; then
  if $BASELINE_KNOWN; then
    say "warning: $VERSION is running but not ready (failing checks: $TOLERATED), as before the update" >&2
  else
    say "warning: $VERSION is running but not ready (failing checks: $TOLERATED): these depend on this machine, not on the release" >&2
  fi
fi

rm -f "$TARGET/$PENDING_MARK"
touch "$TARGET"
prune_releases
say "Released $VERSION"
