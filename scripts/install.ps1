# mimo2codex bootstrap — Windows PowerShell (5.1+) and PowerShell 7+ on any OS.
#
# Usage:
#   irm <raw-url>/scripts/install.ps1 | iex          # one-liner
#   .\scripts\install.ps1                            # if already cloned
#   .\scripts\install.ps1 -Start                     # also start the proxy
#
# Env knobs:
#   $env:MIMO2CODEX_REPO   — git URL to clone (default: official repo)
#   $env:MIMO2CODEX_DIR    — target directory name (default: mimo2codex)
#   $env:MIMO_API_KEY      — required when -Start is passed
#
# What this script does (idempotent):
#   1. Verify git, node >= 18, npm
#   2. Clone or fast-forward-pull the repo
#   3. npm install
#   4. npm run build
#   5. npm test (best-effort)
#   6. Print next-step commands
#   7. (optional) start proxy if -Start was passed
#
[CmdletBinding()]
param(
    [switch]$Start
)

$ErrorActionPreference = "Stop"
$script:RepoUrl  = if ($env:MIMO2CODEX_REPO) { $env:MIMO2CODEX_REPO } else { "https://github.com/your-org/mimo2codex.git" }
$script:Target   = if ($env:MIMO2CODEX_DIR)  { $env:MIMO2CODEX_DIR }  else { "mimo2codex" }

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host " ✓ $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host " ! $msg" -ForegroundColor Yellow }
function Err($msg)  { Write-Host " ✗ $msg" -ForegroundColor Red }

# ── 1. detect prereqs ──────────────────────────────────────────────────────
Step "Checking prerequisites"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Err "git is not installed"
    Write-Host "    Install Git for Windows: https://git-scm.com/download/win"
    Write-Host "    Or via winget: winget install --id Git.Git -e"
    exit 1
}
$gitVer = (git --version) -replace '^git version ', ''
Ok "git $gitVer"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Err "node is not installed"
    Write-Host "    Install Node.js 18+ from https://nodejs.org/"
    Write-Host "    Or via winget: winget install --id OpenJS.NodeJS.LTS -e"
    Write-Host "    Or via nvm-windows: https://github.com/coreybutler/nvm-windows"
    exit 1
}
$nodeMajor = [int]((node -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) {
    Err "node $(node -v) is too old; mimo2codex needs Node.js >= 18"
    exit 1
}
Ok "node $(node -v)"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Err "npm is not installed (it normally ships with Node.js)"
    exit 1
}
Ok "npm $(npm -v)"

# ── 2. clone or pull ───────────────────────────────────────────────────────
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = $null

if ($scriptDir -and (Test-Path "$scriptDir\..\package.json")) {
    $pkg = Get-Content "$scriptDir\..\package.json" -Raw -ErrorAction SilentlyContinue
    if ($pkg -match '"name":\s*"mimo2codex"') {
        $repoRoot = (Resolve-Path "$scriptDir\..").Path
        Step "Detected in-repo run; skipping clone (using $repoRoot)"
    }
}

if (-not $repoRoot) {
    if (Test-Path "$Target\.git") {
        Step "Updating existing clone at .\$Target"
        git -C $Target pull --ff-only
        if ($LASTEXITCODE -ne 0) { throw "git pull failed" }
        $repoRoot = (Resolve-Path $Target).Path
        Ok "pulled latest"
    } else {
        Step "Cloning $RepoUrl -> .\$Target"
        git clone --depth 1 $RepoUrl $Target
        if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
        $repoRoot = (Resolve-Path $Target).Path
        Ok "cloned"
    }
}

Set-Location $repoRoot

# ── 3. install ─────────────────────────────────────────────────────────────
Step "Installing dependencies (npm install)"
npm install --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
Ok "deps installed"

# ── 4. build ───────────────────────────────────────────────────────────────
Step "Building TypeScript (npm run build)"
npm run build --silent
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
Ok "built dist/"

# ── 5. tests (best effort) ─────────────────────────────────────────────────
Step "Running tests"
$null = npm test --silent 2>&1
if ($LASTEXITCODE -eq 0) {
    Ok "all tests pass"
} else {
    Warn "tests failed — proxy may still work; rerun ``npm test`` for details"
}

# ── 6. final instructions ──────────────────────────────────────────────────
Write-Host ""
Write-Host "✓ mimo2codex is ready at $repoRoot" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host ""
Write-Host "  1) Get a MiMo API key (skip if you already have one):" -ForegroundColor Cyan
Write-Host "       https://platform.xiaomimimo.com/#/console/api-keys"
Write-Host ""
Write-Host "  2) Start the proxy:" -ForegroundColor Cyan
Write-Host "       cd `"$repoRoot`""
Write-Host "       `$env:MIMO_API_KEY = 'sk-your-real-mimo-key'"
Write-Host "       node dist\cli.js"
Write-Host ""
Write-Host "  3) Print the Codex config snippet (auth.json + config.toml):" -ForegroundColor Cyan
Write-Host "       node dist\cli.js print-config"
Write-Host ""
Write-Host "     Or for cc-switch users:"
Write-Host "       node dist\cli.js print-cc-switch"
Write-Host ""
Write-Host "  4) Restart Codex (desktop app: fully quit + relaunch)." -ForegroundColor Cyan
Write-Host ""
Write-Host "See README.md / README.zh.md for cc-switch setup, troubleshooting,"
Write-Host "and how to keep the proxy running in the background."
Write-Host ""

# ── 7. optional auto-start ─────────────────────────────────────────────────
if ($Start) {
    if (-not $env:MIMO_API_KEY) {
        Err "MIMO_API_KEY is not set."
        Write-Host "    `$env:MIMO_API_KEY='sk-...' and rerun, or omit -Start."
        exit 1
    }
    Step "Starting proxy"
    node dist\cli.js
}
