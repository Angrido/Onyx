#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MAJOR=22
NODE_MIN_MINOR=18
PNPM_VERSION="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$ROOT/package.json")"
ORIGINAL_PATH="$PATH"
MODE=stub
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

usage() {
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

  stub           agents simulated by the bundled stub, no tokens spent (default)
  real           real Claude Code; implies --with-claude
  --tools-only   install the toolchain only, skip the project setup
  --with-claude  install the Claude Code CLI if it is missing
  -h, --help     show this help
USAGE
}

step() { printf '\n%s==>%s %s%s%s\n' "$ACCENT" "$RESET" "$BOLD" "$*" "$RESET"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '%swarning:%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
fail() {
  printf '%serror:%s %s\n' "$RED" "$RESET" "$*" >&2
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
[ -n "$PNPM_VERSION" ] || fail "Could not read the pnpm version from package.json (packageManager)"

ROOT_OWNER="$(stat -c %u "$ROOT" 2>/dev/null || stat -f %u "$ROOT")"
if [ "$(id -u)" -eq 0 ] && [ "$ROOT_OWNER" -ne 0 ] && ! $TOOLS_ONLY; then
  fail "Run this script as the user who owns $ROOT, not as root: it asks for sudo only for the system steps"
fi

case "$(uname -s)" in
  Linux) NODE_OS=linux ;;
  Darwin) NODE_OS=darwin ;;
  *) fail "Unsupported system: $(uname -s). Onyx runs on Linux and macOS." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) NODE_ARCH=x64 ;;
  aarch64 | arm64) NODE_ARCH=arm64 ;;
  *) fail "Unsupported CPU architecture: $(uname -m)" ;;
esac
if [ "$NODE_OS" = linux ] && ldd --version 2>&1 | grep -qi musl; then
  fail "musl-based distributions (Alpine) are not supported: the official Node.js builds need glibc"
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
    printf 'Some steps may need administrator rights; sudo may ask for your password.\n'
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
  step "System packages"
  if [ "$NODE_OS" = darwin ]; then
    if ! xcode-select -p >/dev/null 2>&1; then
      xcode-select --install >/dev/null 2>&1 || true
      fail "Install the Xcode Command Line Tools from the dialog that just opened, then run this script again"
    fi
    info "Xcode Command Line Tools present (git, make, clang)"
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
    info "git, curl, C/C++ toolchain, Python 3 and SQLite already installed"
    return
  fi

  local packages="" missing
  for missing in $required $optional; do packages="$packages $(package_for "$missing")"; done
  if [ -z "$PKG" ]; then
    [ -z "$required" ] || fail "Missing:$required. Install them with your package manager and run this script again."
    warn "sqlite3 is missing (used only by the backup script)"
    return
  fi
  if ! $CAN_ELEVATE; then
    [ -z "$required" ] || fail "Missing:$required. Run this script as root or with sudo rights, or install:$packages"
    warn "sqlite3 is missing (used only by the backup script); install it with: $PKG install$packages"
    return
  fi
  info "Installing:$packages"
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
  [ -n "$version" ] || fail "Could not find the latest Node.js ${NODE_MAJOR} release on nodejs.org"
  base="node-${version}-${NODE_OS}-${NODE_ARCH}"
  work="$(mktemp -d)"
  info "Downloading ${base}"
  curl -fsSL "https://nodejs.org/dist/${version}/${base}.tar.gz" -o "$work/${base}.tar.gz"
  curl -fsSL "https://nodejs.org/dist/${version}/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
  expected="$(awk -v file="${base}.tar.gz" '$2 == file { print $1 }' "$work/SHASUMS256.txt")"
  actual="$(sha256_of "$work/${base}.tar.gz")"
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    rm -rf "$work"
    fail "Checksum mismatch for ${base}.tar.gz"
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
    info "Node.js $(node_version) already installed ($(command -v node))"
    [ "$(node_version | cut -d. -f1)" = "$NODE_MAJOR" ] ||
      warn "Onyx is tested on Node.js ${NODE_MAJOR}; $(node_version) should work but is not covered by CI"
    return
  fi
  if has node; then
    info "Node.js $(node_version) is too old: ${NODE_MAJOR}.${NODE_MIN_MINOR} or newer is required"
  fi
  if [ "$PKG" = apt-get ] && $CAN_ELEVATE; then
    info "Installing Node.js ${NODE_MAJOR} from NodeSource"
    if install_node_from_nodesource; then
      hash -r
      if node_is_supported; then
        info "Node.js $(node_version) installed ($(command -v node))"
        return
      fi
      warn "Node.js from NodeSource is not the one found first in PATH; installing the official build instead"
    else
      warn "NodeSource is unreachable; installing the official build from nodejs.org instead"
    fi
  fi
  install_node_from_tarball
  node_is_supported || fail "Node.js $(node_version) is still found first in PATH ($(command -v node)); remove it or put ${INSTALLED_BIN} first"
  info "Node.js $(node_version) installed ($(command -v node))"
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
    info "pnpm ${PNPM_VERSION} ready ($(command -v pnpm))"
    return
  fi
  info "Activating pnpm ${PNPM_VERSION}"
  if ! enable_pnpm_with_corepack || [ "$(pnpm_version)" != "$PNPM_VERSION" ]; then
    info "corepack did not provide pnpm ${PNPM_VERSION}; installing it with npm"
    install_pnpm_with_npm || fail "Could not install pnpm ${PNPM_VERSION}. Run this script with sudo rights or install pnpm manually."
  fi
  local found
  found="$(pnpm_version)"
  [ "$found" = "$PNPM_VERSION" ] ||
    fail "pnpm ${found:-is missing} is found first in PATH ($(command -v pnpm || printf 'none')); ${PNPM_VERSION} is required"
  info "pnpm ${PNPM_VERSION} ready ($(command -v pnpm))"
}

ensure_claude() {
  step "Claude Code CLI"
  if has claude; then
    info "Claude Code $(claude --version 2>/dev/null | awk 'NR == 1') already installed ($(command -v claude))"
    return
  fi
  info "Installing Claude Code for $(id -un)"
  curl -fsSL https://claude.ai/install.sh | bash
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *) export PATH="$HOME/.local/bin:$PATH" ;;
  esac
  hash -r
  has claude || fail "The Claude Code installer finished but claude is not on PATH"
  info "Claude Code installed ($(command -v claude)). Authenticate with: claude"
}

setup_project() {
  step "Project dependencies"
  (cd "$ROOT" && pnpm install --frozen-lockfile)
  step "Development environment (${MODE})"
  "$ROOT/scripts/dev-setup.sh" "$MODE"
  step "Commands"
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
    warn "${INSTALLED_BIN} is not first in your PATH. Add this line to your shell profile (~/.bashrc, ~/.zshrc or ~/.profile):"
    printf '    export PATH="%s:%s"\n' "$INSTALLED_BIN" "\$PATH"
  fi
  if $WITH_CLAUDE && ! PATH="$ORIGINAL_PATH" command -v claude >/dev/null 2>&1; then
    warn "claude is in ~/.local/bin, which is not in your PATH: add it to your shell profile"
  fi
}

ensure_system_packages
ensure_node
ensure_pnpm
if $WITH_CLAUDE; then ensure_claude; fi
if ! $TOOLS_ONLY; then setup_project; fi
summary
if $TOOLS_ONLY; then
  printf '\nToolchain ready. Prepare the project with: scripts/install.sh %s\n' "$MODE"
else
  printf '\nStart Onyx with onyx-start, stop it with onyx-stop, update it with onyx-update.\n'
fi
