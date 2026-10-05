#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MAJOR=22
NODE_MIN_MINOR=18
PNPM_VERSION="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$ROOT/package.json")"
ORIGINAL_PATH="$PATH"
MODE=real
TOOLS_ONLY=false
WITH_CLAUDE=false
SUDO=""
CAN_ELEVATE=false
INSTALLED_BIN=""

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

if [ -t 1 ]; then
  BOLD=$'\033[1m'
  ACCENT=$'\033[1;35m'
  YELLOW=$'\033[1;33m'
  RED=$'\033[1;31m'
  RESET=$'\033[0m'
else
  BOLD=""
  ACCENT=""
  YELLOW=""
  RED=""
  RESET=""
fi

english() {
  case "${ONYX_LANG:-}" in
    en | en_* | en-* | en.*) return 0 ;;
    *) return 1 ;;
  esac
}
text() { if english; then printf '%s' "$2"; else printf '%s' "$1"; fi; }

usage() {
  if ! english; then
    cat <<'USAGE'
Uso: scripts/install.sh [stub|real] [--tools-only] [--with-claude]

Installa quello che manca per sviluppare ed eseguire Onyx, poi prepara il
progetto. Gli strumenti già presenti non vengono toccati.

  Pacchetti di sistema  git, curl, certificati CA, toolchain C/C++, Python 3, SQLite
  Node.js               22 LTS (almeno 22.18): NodeSource su Debian/Ubuntu,
                        build ufficiale di nodejs.org altrove o quando NodeSource
                        non è raggiungibile
  pnpm                  la versione fissata in package.json, tramite corepack
  Claude Code CLI       solo con --with-claude o in modalità real

Poi esegue pnpm install e scripts/dev-setup.sh.

  real           il vero Claude Code, installato se manca (predefinito): accedi
                 con il tuo account Claude da Impostazioni
  stub           agenti simulati dallo stub incluso, per sviluppo e test:
                 nessun token speso e nessun accesso reale
  --tools-only   installa solo la toolchain, salta la preparazione del progetto
  --with-claude  installa la CLI di Claude Code se manca
  -h, --help     mostra questo aiuto

Messaggi in inglese: ONYX_LANG=en.
USAGE
    return 0
  fi
  cat <<'USAGE'
Usage: scripts/install.sh [stub|real] [--tools-only] [--with-claude]

Installs whatever is missing to develop and run Onyx, then prepares the
project. Tools that are already present are left untouched.

  System packages  git, curl, CA certificates, C/C++ toolchain, Python 3, SQLite
  Node.js          22 LTS (at least 22.18): NodeSource on Debian/Ubuntu,
                   official nodejs.org build elsewhere or when NodeSource
                   is unreachable
  pnpm             the version pinned in package.json, through corepack
  Claude Code CLI  only with --with-claude or in real mode

Then runs pnpm install and scripts/dev-setup.sh.

  real           the real Claude Code, installed if missing (default): sign in
                 with your Claude account from Settings
  stub           agents simulated by the bundled stub, for development and
                 tests: no tokens spent and no real sign-in
  --tools-only   install the toolchain only, skip the project setup
  --with-claude  install the Claude Code CLI if it is missing
  -h, --help     show this help

Italian messages are the default: ONYX_LANG=en switches to English.
USAGE
}

step() { printf '\n%s==>%s %s%s%s\n' "$ACCENT" "$RESET" "$BOLD" "$*" "$RESET"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '%s%s:%s %s\n' "$YELLOW" "$(text attenzione warning)" "$RESET" "$*" >&2; }
fail() {
  printf '%s%s:%s %s\n' "$RED" "$(text errore error)" "$RESET" "$*" >&2
  exit 1
}
has() { command -v "$1" >/dev/null 2>&1; }

while [ $# -gt 0 ]; do
  case "$1" in
    stub | real) MODE="$1" ;;
    --tools-only) TOOLS_ONLY=true ;;
    --with-claude) WITH_CLAUDE=true ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
  shift
done
[ "$MODE" = real ] && WITH_CLAUDE=true
[ -n "$PNPM_VERSION" ] || fail "$(text "Impossibile leggere la versione di pnpm da package.json (packageManager)" "Could not read the pnpm version from package.json (packageManager)")"

ROOT_OWNER="$(stat -c %u "$ROOT" 2>/dev/null || stat -f %u "$ROOT")"
if [ "$(id -u)" -eq 0 ] && [ "$ROOT_OWNER" -ne 0 ] && ! $TOOLS_ONLY; then
  fail "$(text "Esegui questo script come l'utente proprietario di $ROOT, non come root: chiede sudo solo per i passi di sistema" "Run this script as the user who owns $ROOT, not as root: it asks for sudo only for the system steps")"
fi

case "$(uname -s)" in
  Linux) NODE_OS=linux ;;
  Darwin) NODE_OS=darwin ;;
  *) fail "$(text "Sistema non supportato: $(uname -s). Onyx gira su Linux e macOS." "Unsupported system: $(uname -s). Onyx runs on Linux and macOS.")" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) NODE_ARCH=x64 ;;
  aarch64 | arm64) NODE_ARCH=arm64 ;;
  *) fail "$(text "Architettura della CPU non supportata: $(uname -m)" "Unsupported CPU architecture: $(uname -m)")" ;;
esac
if [ "$NODE_OS" = linux ] && ldd --version 2>&1 | grep -qi musl; then
  fail "$(text "le distribuzioni basate su musl (Alpine) non sono supportate: le build ufficiali di Node.js richiedono glibc" "musl-based distributions (Alpine) are not supported: the official Node.js builds need glibc")"
fi

PKG=""
for candidate in apt-get dnf pacman zypper; do
  if has "$candidate"; then
    PKG="$candidate"
    break
  fi
done

if [ "$(id -u)" -eq 0 ]; then
  CAN_ELEVATE=true
elif has sudo; then
  if sudo -n true 2>/dev/null; then
    SUDO=sudo
    CAN_ELEVATE=true
  elif [ -t 0 ]; then
    printf '%s\n' "$(text "Alcuni passi possono richiedere i diritti di amministratore; sudo può chiederti la password." "Some steps may need administrator rights; sudo may ask for your password.")"
    if sudo -v; then
      SUDO=sudo
      CAN_ELEVATE=true
    fi
  fi
fi

package_for() {
  case "$PKG:$1" in
    apt-get:toolchain) printf 'build-essential' ;;
    dnf:toolchain | zypper:toolchain) printf 'gcc-c++ make' ;;
    pacman:toolchain) printf 'base-devel' ;;
    pacman:python3) printf 'python' ;;
    dnf:sqlite3 | pacman:sqlite3) printf 'sqlite' ;;
    *:certificates) printf 'ca-certificates' ;;
    *) printf '%s' "$1" ;;
  esac
}

has_certificates() {
  [ -s /etc/ssl/certs/ca-certificates.crt ] || [ -s /etc/pki/tls/certs/ca-bundle.crt ] ||
    [ -s /etc/ssl/ca-bundle.pem ] || [ -s /etc/ssl/cert.pem ]
}

install_packages() {
  case "$PKG" in
    apt-get)
      $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update -qq
      $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "$@"
      ;;
    dnf) $SUDO dnf install -y "$@" ;;
    pacman) $SUDO pacman -Sy --needed --noconfirm "$@" ;;
    zypper) $SUDO zypper --non-interactive install "$@" ;;
  esac
}

ensure_system_packages() {
  step "$(text "Pacchetti di sistema" "System packages")"
  if [ "$NODE_OS" = darwin ]; then
    if ! xcode-select -p >/dev/null 2>&1; then
      xcode-select --install >/dev/null 2>&1 || true
      fail "$(text "Installa gli Xcode Command Line Tools dalla finestra appena aperta, poi esegui di nuovo questo script" "Install the Xcode Command Line Tools from the dialog that just opened, then run this script again")"
    fi
    info "$(text "Xcode Command Line Tools presenti (git, make, clang)" "Xcode Command Line Tools present (git, make, clang)")"
    return
  fi

  local required="" optional="" tool
  for tool in git curl tar gzip python3; do
    has "$tool" || required="$required $tool"
  done
  if ! has make || { ! has g++ && ! has c++; }; then required="$required toolchain"; fi
  has_certificates || required="$required certificates"
  has sqlite3 || optional="$optional sqlite3"

  if [ -z "$required$optional" ]; then
    info "$(text "git, curl, toolchain C/C++, Python 3 e SQLite già installati" "git, curl, C/C++ toolchain, Python 3 and SQLite already installed")"
    return
  fi

  local packages="" missing
  for missing in $required $optional; do packages="$packages $(package_for "$missing")"; done
  if [ -z "$PKG" ]; then
    [ -z "$required" ] || fail "$(text "Mancano:$required. Installali con il gestore di pacchetti ed esegui di nuovo questo script." "Missing:$required. Install them with your package manager and run this script again.")"
    warn "$(text "manca sqlite3 (serve solo allo script di backup)" "sqlite3 is missing (used only by the backup script)")"
    return
  fi
  if ! $CAN_ELEVATE; then
    [ -z "$required" ] || fail "$(text "Mancano:$required. Esegui questo script come root o con i diritti di sudo, oppure installa:$packages" "Missing:$required. Run this script as root or with sudo rights, or install:$packages")"
    warn "$(text "manca sqlite3 (serve solo allo script di backup); installalo con: $PKG install$packages" "sqlite3 is missing (used only by the backup script); install it with: $PKG install$packages")"
    return
  fi
  info "$(text "Installazione di:$packages" "Installing:$packages")"
  local list
  read -r -a list <<<"$packages"
  install_packages "${list[@]}"
}

node_version() {
  node -p 'process.versions.node' 2>/dev/null || true
}

node_is_supported() {
  local version major minor
  version="$(node_version)"
  [ -n "$version" ] || return 1
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  [ "$major" -gt "$NODE_MAJOR" ] || { [ "$major" -eq "$NODE_MAJOR" ] && [ "$minor" -ge "$NODE_MIN_MINOR" ]; }
}

sha256_of() {
  if has sha256sum; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

install_node_from_nodesource() {
  local script
  script="$(mktemp)"
  if ! curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o "$script" 2>/dev/null; then
    rm -f "$script"
    return 1
  fi
  if ! $SUDO bash "$script" >/dev/null; then
    rm -f "$script"
    return 1
  fi
  rm -f "$script"
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
}

install_node_from_tarball() {
  local version base work expected actual prefix bin tool run=""
  version="$(curl -fsSL https://nodejs.org/dist/index.json |
    grep -o "\"version\":\"v${NODE_MAJOR}\.[0-9]*\.[0-9]*\"" | awk -F'"' 'NR == 1 { print $4 }')"
  [ -n "$version" ] || fail "$(text "Impossibile trovare l'ultima release di Node.js ${NODE_MAJOR} su nodejs.org" "Could not find the latest Node.js ${NODE_MAJOR} release on nodejs.org")"
  base="node-${version}-${NODE_OS}-${NODE_ARCH}"
  work="$(mktemp -d)"
  info "$(text "Download di ${base}" "Downloading ${base}")"
  curl -fsSL "https://nodejs.org/dist/${version}/${base}.tar.gz" -o "$work/${base}.tar.gz"
  curl -fsSL "https://nodejs.org/dist/${version}/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
  expected="$(awk -v file="${base}.tar.gz" '$2 == file { print $1 }' "$work/SHASUMS256.txt")"
  actual="$(sha256_of "$work/${base}.tar.gz")"
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    rm -rf "$work"
    fail "$(text "Checksum non corrispondente per ${base}.tar.gz" "Checksum mismatch for ${base}.tar.gz")"
  fi

  if $CAN_ELEVATE; then
    prefix=/usr/local/lib/nodejs
    bin=/usr/local/bin
    run="$SUDO"
  else
    prefix="$HOME/.local/lib/nodejs"
    bin="$HOME/.local/bin"
  fi
  $run mkdir -p "$prefix" "$bin"
  $run rm -rf "${prefix:?}/${base}"
  $run tar --no-same-owner -xzf "$work/${base}.tar.gz" -C "$prefix"
  for tool in node npm npx corepack; do
    $run ln -sf "$prefix/$base/bin/$tool" "$bin/$tool"
  done
  rm -rf "$work"
  INSTALLED_BIN="$bin"
  export PATH="$bin:$PATH"
  hash -r
}

ensure_node() {
  step "Node.js"
  if node_is_supported; then
    info "$(text "Node.js $(node_version) già installato ($(command -v node))" "Node.js $(node_version) already installed ($(command -v node))")"
    [ "$(node_version | cut -d. -f1)" = "$NODE_MAJOR" ] ||
      warn "$(text "Onyx è testato su Node.js ${NODE_MAJOR}; $(node_version) dovrebbe funzionare ma non è coperto dalla CI" "Onyx is tested on Node.js ${NODE_MAJOR}; $(node_version) should work but is not covered by CI")"
    return
  fi
  if has node; then
    info "$(text "Node.js $(node_version) è troppo vecchio: serve ${NODE_MAJOR}.${NODE_MIN_MINOR} o più recente" "Node.js $(node_version) is too old: ${NODE_MAJOR}.${NODE_MIN_MINOR} or newer is required")"
  fi
  if [ "$PKG" = apt-get ] && $CAN_ELEVATE; then
    info "$(text "Installazione di Node.js ${NODE_MAJOR} da NodeSource" "Installing Node.js ${NODE_MAJOR} from NodeSource")"
    if install_node_from_nodesource; then
      hash -r
      if node_is_supported; then
        info "$(text "Node.js $(node_version) installato ($(command -v node))" "Node.js $(node_version) installed ($(command -v node))")"
        return
      fi
      warn "$(text "il Node.js di NodeSource non è il primo trovato nel PATH; installo invece la build ufficiale" "Node.js from NodeSource is not the one found first in PATH; installing the official build instead")"
    else
      warn "$(text "NodeSource non è raggiungibile; installo invece la build ufficiale da nodejs.org" "NodeSource is unreachable; installing the official build from nodejs.org instead")"
    fi
  fi
  install_node_from_tarball
  node_is_supported || fail "$(text "Node.js $(node_version) è ancora il primo trovato nel PATH ($(command -v node)); rimuovilo o metti prima ${INSTALLED_BIN}" "Node.js $(node_version) is still found first in PATH ($(command -v node)); remove it or put ${INSTALLED_BIN} first")"
  info "$(text "Node.js $(node_version) installato ($(command -v node))" "Node.js $(node_version) installed ($(command -v node))")"
}

pnpm_version() {
  has pnpm || return 0
  (cd "$ROOT" && pnpm --version 2>/dev/null) || true
}

enable_pnpm_with_corepack() {
  local node_bin corepack_bin target run=""
  has corepack || return 1
  node_bin="$(command -v node)"
  corepack_bin="$(command -v corepack)"
  target="$(dirname "$node_bin")"
  if [ ! -w "$target" ]; then
    $CAN_ELEVATE || return 1
    run="$SUDO"
  fi
  $run "$node_bin" "$corepack_bin" enable --install-directory "$target" pnpm || return 1
  corepack install -g "pnpm@${PNPM_VERSION}" >/dev/null 2>&1 ||
    corepack prepare "pnpm@${PNPM_VERSION}" --activate >/dev/null 2>&1 || true
  hash -r
}

install_pnpm_with_npm() {
  local prefix target run=""
  prefix="$(npm prefix -g)"
  if [ ! -w "$prefix" ]; then
    $CAN_ELEVATE || return 1
    run="$SUDO"
  fi
  $run "$(command -v npm)" install -g "pnpm@${PNPM_VERSION}" >/dev/null || return 1
  hash -r
  if ! has pnpm && [ -x "$prefix/bin/pnpm" ]; then
    target="$(dirname "$(command -v node)")"
    $run ln -sf "$prefix/bin/pnpm" "$target/pnpm"
    hash -r
  fi
}

ensure_pnpm() {
  step "pnpm"
  if [ "$(pnpm_version)" = "$PNPM_VERSION" ]; then
    info "$(text "pnpm ${PNPM_VERSION} pronto ($(command -v pnpm))" "pnpm ${PNPM_VERSION} ready ($(command -v pnpm))")"
    return
  fi
  info "$(text "Attivazione di pnpm ${PNPM_VERSION}" "Activating pnpm ${PNPM_VERSION}")"
  if ! enable_pnpm_with_corepack || [ "$(pnpm_version)" != "$PNPM_VERSION" ]; then
    info "$(text "corepack non ha fornito pnpm ${PNPM_VERSION}; lo installo con npm" "corepack did not provide pnpm ${PNPM_VERSION}; installing it with npm")"
    install_pnpm_with_npm || fail "$(text "Impossibile installare pnpm ${PNPM_VERSION}. Esegui questo script con i diritti di sudo o installa pnpm a mano." "Could not install pnpm ${PNPM_VERSION}. Run this script with sudo rights or install pnpm manually.")"
  fi
  local found
  found="$(pnpm_version)"
  [ "$found" = "$PNPM_VERSION" ] ||
    fail "$(text "pnpm ${found:-manca} è il primo trovato nel PATH ($(command -v pnpm || printf 'nessuno')); serve ${PNPM_VERSION}" "pnpm ${found:-is missing} is found first in PATH ($(command -v pnpm || printf 'none')); ${PNPM_VERSION} is required")"
  info "$(text "pnpm ${PNPM_VERSION} pronto ($(command -v pnpm))" "pnpm ${PNPM_VERSION} ready ($(command -v pnpm))")"
}

ensure_claude() {
  step "Claude Code CLI"
  if has claude; then
    info "Claude Code $(claude --version 2>/dev/null | awk 'NR == 1') $(text "già installato" "already installed") ($(command -v claude))"
    return
  fi
  info "$(text "Installazione di Claude Code per $(id -un)" "Installing Claude Code for $(id -un)")"
  curl -fsSL https://claude.ai/install.sh | bash
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) export PATH="$HOME/.local/bin:$PATH" ;;
  esac
  hash -r
  has claude || fail "$(text "L'installer di Claude Code è finito ma claude non è nel PATH" "The Claude Code installer finished but claude is not on PATH")"
  info "$(text "Claude Code installato ($(command -v claude)). Autenticati con: claude" "Claude Code installed ($(command -v claude)). Authenticate with: claude")"
}

setup_project() {
  step "$(text "Dipendenze del progetto" "Project dependencies")"
  (cd "$ROOT" && pnpm install --frozen-lockfile)
  step "$(text "Ambiente di sviluppo (${MODE})" "Development environment (${MODE})")"
  "$ROOT/scripts/dev-setup.sh" "$MODE"
  step "$(text "Comandi" "Commands")"
  "$ROOT/scripts/onyx" install
}

summary() {
  step "Toolchain"
  info "Node.js  $(node_version)  $(command -v node)"
  info "pnpm     $(pnpm_version)  $(command -v pnpm)"
  info "git      $(git --version | awk '{ print $3 }')"
  if has claude; then info "claude   $(claude --version 2>/dev/null | awk 'NR == 1 { print $1 }')"; fi
  local default_node=""
  default_node="$(PATH="$ORIGINAL_PATH" command -v node 2>/dev/null || true)"
  if [ -n "$INSTALLED_BIN" ] && [ "$default_node" != "$INSTALLED_BIN/node" ]; then
    printf '\n'
    warn "$(text "${INSTALLED_BIN} non è il primo nel tuo PATH. Aggiungi questa riga al profilo della shell (~/.bashrc, ~/.zshrc o ~/.profile):" "${INSTALLED_BIN} is not first in your PATH. Add this line to your shell profile (~/.bashrc, ~/.zshrc or ~/.profile):")"
    printf '    export PATH="%s:%s"\n' "$INSTALLED_BIN" "\$PATH"
  fi
  if $WITH_CLAUDE && ! PATH="$ORIGINAL_PATH" command -v claude >/dev/null 2>&1; then
    warn "$(text "claude è in ~/.local/bin, che non è nel tuo PATH: aggiungilo al profilo della shell" "claude is in ~/.local/bin, which is not in your PATH: add it to your shell profile")"
  fi
}

ensure_system_packages
ensure_node
ensure_pnpm
if $WITH_CLAUDE; then ensure_claude; fi
if ! $TOOLS_ONLY; then setup_project; fi
summary
if $TOOLS_ONLY; then
  printf '\n%s %s\n' "$(text "Toolchain pronta. Prepara il progetto con: scripts/install.sh" "Toolchain ready. Prepare the project with: scripts/install.sh")" "$MODE"
else
  printf '\n%s\n' "$(text "Avvia Onyx con onyx-start, fermalo con onyx-stop, aggiornalo con onyx-update." "Start Onyx with onyx-start, stop it with onyx-stop, update it with onyx-update.")"
fi
