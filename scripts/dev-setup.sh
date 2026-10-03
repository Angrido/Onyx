#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$ROOT/.onyx-data"
MODE="${1:-stub}"

case "$MODE" in
  stub) CLAUDE_BIN="$ROOT/packages/agent-runtime/bin/claude-stub.ts" ;;
  real) CLAUDE_BIN="$(command -v claude || printf 'claude')" ;;
  *)
    printf 'usage: dev-setup.sh [stub|real]\n' >&2
    exit 1
    ;;
esac

mkdir -p "$DATA/projects/demo/src"
if [ ! -f "$DATA/projects/demo/src/math.ts" ]; then
  printf 'export function add(a: number, b: number): number {\n  return a - b;\n}\n' > "$DATA/projects/demo/src/math.ts"
fi

cat > "$ROOT/apps/api/.env" <<ENV
NODE_ENV=development
LOG_LEVEL=info
API_HOST=0.0.0.0
DATABASE_URL=file:$DATA/onyx.db
ONYX_DATA_DIR=$DATA
ONYX_PROJECTS_DIR=$DATA/projects
CLAUDE_BIN=$CLAUDE_BIN
ONYX_CHILD_ENV_PASSTHROUGH=CLAUDE_STUB_DELAY_MS
CLAUDE_STUB_DELAY_MS=400
ENV

DATABASE_URL="file:$DATA/onyx.db" pnpm --filter @onyx/db migrate:deploy

printf '\nDev environment ready in %s mode.\n' "$MODE"
printf 'Demo project: %s\n' "$DATA/projects/demo"
printf 'Start everything with: pnpm dev\n'
printf 'Open the UI from any device on the network:\n'
printf '  http://localhost:3000\n'
for address in $(hostname -I 2>/dev/null); do
  case "$address" in
    *:*) printf '  http://[%s]:3000\n' "$address" ;;
    *) printf '  http://%s:3000\n' "$address" ;;
  esac
done
printf '  http://%s.local:3000 (with mDNS)\n' "$(hostname)"
