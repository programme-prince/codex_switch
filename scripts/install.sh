#!/usr/bin/env bash
# mimo2codex bootstrap — Linux / macOS / WSL / Git Bash on Windows.
# Usage:
#   curl -fsSL <raw-url>/scripts/install.sh | bash
#   ./scripts/install.sh                    # if already cloned
#   ./scripts/install.sh --start            # also start the proxy after install
#
# Env knobs:
#   MIMO2CODEX_REPO   — git URL to clone (default: official repo)
#   MIMO2CODEX_DIR    — target directory name (default: mimo2codex)
#   MIMO_API_KEY      — set to auto-start proxy when --start is passed
#
# What this script does (idempotent):
#   1. Verify git ≥ any, node ≥ 18, npm available
#   2. Clone or fast-forward-pull the repo
#   3. npm install   (skips audit/fund noise)
#   4. npm run build (compile TypeScript)
#   5. npm test      (best-effort; warn on failure but don't abort)
#   6. Print next-step commands
#   7. (optional) start the proxy if --start was passed
#
set -euo pipefail

REPO_URL="${MIMO2CODEX_REPO:-https://github.com/your-org/mimo2codex.git}"
TARGET_DIR="${MIMO2CODEX_DIR:-mimo2codex}"
START_AFTER=false
for arg in "$@"; do
  case "$arg" in
    --start) START_AFTER=true ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

# ── colors ──────────────────────────────────────────────────────────────────
if [[ -t 1 ]] && [[ "${TERM:-}" != "dumb" ]]; then
  C_RED='\033[0;31m'; C_GRN='\033[0;32m'; C_YEL='\033[0;33m'
  C_CYN='\033[0;36m'; C_BLD='\033[1m';   C_RST='\033[0m'
else
  C_RED=''; C_GRN=''; C_YEL=''; C_CYN=''; C_BLD=''; C_RST=''
fi
step() { printf "${C_CYN}${C_BLD}==>${C_RST} ${C_BLD}%s${C_RST}\n" "$1"; }
ok()   { printf "${C_GRN} ✓${C_RST} %s\n" "$1"; }
warn() { printf "${C_YEL} !${C_RST} %s\n" "$1"; }
err()  { printf "${C_RED} ✗${C_RST} %s\n" "$1" >&2; }

# ── 1. detect prereqs ──────────────────────────────────────────────────────
step "Checking prerequisites"

if ! command -v git >/dev/null 2>&1; then
  err "git is not installed"
  echo "    macOS:   xcode-select --install   (or: brew install git)"
  echo "    Linux:   sudo apt-get install -y git   (or your distro's package manager)"
  echo "    Windows: install Git for Windows: https://git-scm.com/download/win"
  exit 1
fi
ok "git $(git --version | awk '{print $3}')"

if ! command -v node >/dev/null 2>&1; then
  err "node is not installed"
  echo "    Install Node.js 18+ from https://nodejs.org/"
  echo "    Or use a version manager:"
  echo "      nvm:   https://github.com/nvm-sh/nvm"
  echo "      fnm:   https://github.com/Schniz/fnm"
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  err "node $(node -v) is too old; mimo2codex needs Node.js >= 18"
  exit 1
fi
ok "node $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  err "npm is not installed (it normally ships with Node.js)"
  exit 1
fi
ok "npm $(npm -v)"

# ── 2. clone or pull ───────────────────────────────────────────────────────
# If we're invoked from inside a working clone (e.g. a contributor running it
# locally), skip the clone step and just use $PWD.
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=""
if [[ -f "$SCRIPT_DIR/../package.json" ]] && grep -q '"name": "mimo2codex"' "$SCRIPT_DIR/../package.json" 2>/dev/null; then
  ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
  step "Detected in-repo run; skipping clone (using $ROOT_DIR)"
elif [[ -d "$TARGET_DIR/.git" ]]; then
  step "Updating existing clone at ./$TARGET_DIR"
  git -C "$TARGET_DIR" pull --ff-only
  ROOT_DIR=$(cd -- "$TARGET_DIR" && pwd)
  ok "pulled latest"
else
  step "Cloning $REPO_URL → ./$TARGET_DIR"
  git clone --depth 1 "$REPO_URL" "$TARGET_DIR"
  ROOT_DIR=$(cd -- "$TARGET_DIR" && pwd)
  ok "cloned"
fi

cd "$ROOT_DIR"

# ── 3. install ─────────────────────────────────────────────────────────────
step "Installing dependencies (npm install)"
npm install --no-audit --no-fund --loglevel=error
ok "deps installed"

# ── 4. build ───────────────────────────────────────────────────────────────
step "Building TypeScript (npm run build)"
npm run build --silent
ok "built dist/"

# ── 5. tests (best effort) ─────────────────────────────────────────────────
step "Running tests"
if npm test --silent >/dev/null 2>&1; then
  ok "all tests pass"
else
  warn "tests failed — proxy may still work; rerun \`npm test\` for details"
fi

# ── 6. final instructions ──────────────────────────────────────────────────
cat <<EOF

${C_GRN}${C_BLD}✓ mimo2codex is ready at${C_RST} ${C_BLD}$ROOT_DIR${C_RST}

${C_BLD}Next steps:${C_RST}

  ${C_CYN}1)${C_RST} Get a MiMo API key (skip if you already have one):
       https://platform.xiaomimimo.com/#/console/api-keys

  ${C_CYN}2)${C_RST} Start the proxy:
       cd $ROOT_DIR
       export MIMO_API_KEY=sk-your-real-mimo-key
       node dist/cli.js

  ${C_CYN}3)${C_RST} Print the Codex config snippet (auth.json + config.toml):
       node dist/cli.js print-config

     Or for cc-switch users:
       node dist/cli.js print-cc-switch

  ${C_CYN}4)${C_RST} Restart Codex (desktop: fully quit + relaunch).

See README.md / README.zh.md for cc-switch setup, troubleshooting, and
how to keep the proxy running in the background (systemd / pm2).

EOF

# ── 7. optional auto-start ─────────────────────────────────────────────────
if [[ "$START_AFTER" == "true" ]]; then
  if [[ -z "${MIMO_API_KEY:-}" ]]; then
    err "MIMO_API_KEY is not set in your environment."
    echo "    export MIMO_API_KEY=sk-... and rerun, or omit --start."
    exit 1
  fi
  step "Starting proxy"
  exec node dist/cli.js
fi
