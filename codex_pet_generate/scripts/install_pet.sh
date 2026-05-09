#!/usr/bin/env bash
# install_pet.sh — drop a generated pet into Codex's pet directory.
#
# Usage:
#   bash install_pet.sh <pet.png> <pet-name> [display-name]
#   bash install_pet.sh --bundle <dir>/ <pet-name> [display-name]
#
# Generates a Codex-compatible pet with:
#   - pet.json (id, displayName, description, spritesheetPath)
#   - spritesheet.webp (1536x1872, 8 cols x 9 rows, 192x208 per frame)
#
# After install, FULLY QUIT and relaunch Codex (system tray → Quit, not just
# close window). The new pet should appear in the picker.
#
set -euo pipefail

# ── colors ──────────────────────────────────────────────────────────────────
if [[ -t 1 ]] && [[ "${TERM:-}" != "dumb" ]]; then
  C_GRN='\033[0;32m'; C_YEL='\033[0;33m'; C_RED='\033[0;31m'
  C_CYN='\033[0;36m'; C_BLD='\033[1m';   C_RST='\033[0m'
else
  C_GRN=''; C_YEL=''; C_RED=''; C_CYN=''; C_BLD=''; C_RST=''
fi
step() { printf "${C_CYN}${C_BLD}==>${C_RST} %s\n" "$1"; }
ok()   { printf "${C_GRN} ✓${C_RST} %s\n" "$1"; }
warn() { printf "${C_YEL} !${C_RST} %s\n" "$1"; }
err()  { printf "${C_RED} ✗${C_RST} %s\n" "$1" >&2; }

# Find a working Python interpreter with Pillow
detect_python() {
  for c in python3 python py; do
    if command -v "$c" >/dev/null 2>&1; then
      if "$c" -c "from PIL import Image; sys.exit(0)" 2>/dev/null; then
        echo "$c"
        return 0
      fi
    fi
  done
  return 1
}
PY=$(detect_python || true)
if [[ -z "$PY" ]]; then
  err "no working Python interpreter with Pillow found"
  err "install: pip install Pillow"
  exit 1
fi

# ── args ────────────────────────────────────────────────────────────────────
BUNDLE_MODE=false
SOURCE=""
NAME=""
DISPLAY_NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle)
      BUNDLE_MODE=true
      SOURCE="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      if [[ -z "$SOURCE" ]]; then SOURCE="$1"
      elif [[ -z "$NAME" ]]; then NAME="$1"
      elif [[ -z "$DISPLAY_NAME" ]]; then DISPLAY_NAME="$1"
      else err "unexpected arg: $1"; exit 2
      fi
      shift
      ;;
  esac
done

if [[ -z "$SOURCE" ]] || [[ -z "$NAME" ]]; then
  err "usage: install_pet.sh <pet.png|--bundle DIR> <pet-name> [display-name]"
  exit 2
fi

if ! [[ -e "$SOURCE" ]]; then
  err "source does not exist: $SOURCE"
  exit 1
fi

# Sanitize pet name (lowercase, alnum + dash)
SAFE_NAME=$(printf '%s' "$NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g; s/--*/-/g; s/^-//; s/-$//')
if [[ -z "$SAFE_NAME" ]]; then
  err "pet name '$NAME' yields empty slug after sanitization"
  exit 1
fi

# Default display name to the safe name
[[ -z "$DISPLAY_NAME" ]] && DISPLAY_NAME="$SAFE_NAME"

# ── locate Codex pet folder ─────────────────────────────────────────────────
step "Locating Codex pet folder"

CANDIDATES=()
case "$(uname -s)" in
  Darwin)
    CANDIDATES+=(
      "$HOME/Library/Application Support/Codex/pets"
      "$HOME/Documents/Codex/pets"
      "$HOME/.codex/pets"
    )
    ;;
  Linux)
    CANDIDATES+=(
      "$HOME/.config/Codex/pets"
      "$HOME/.local/share/Codex/pets"
      "$HOME/.codex/pets"
    )
    ;;
  MINGW*|MSYS*|CYGWIN*)
    CANDIDATES+=(
      "${APPDATA:-$HOME/AppData/Roaming}/Codex/pets"
      "$HOME/.codex/pets"
    )
    ;;
  *)
    CANDIDATES+=("$HOME/.codex/pets")
    ;;
esac

PET_DIR=""
for c in "${CANDIDATES[@]}"; do
  parent=$(dirname "$c")
  if [[ -d "$parent" ]]; then
    PET_DIR="$c"
    ok "found Codex parent at $parent — using $PET_DIR"
    break
  fi
done

if [[ -z "$PET_DIR" ]]; then
  PET_DIR="$HOME/.codex/pets"
  warn "no existing Codex directory found; defaulting to $PET_DIR"
  warn "if Codex doesn't pick this up, copy the bundle to its actual pets/ folder manually"
fi

mkdir -p "$PET_DIR"

# ── install ─────────────────────────────────────────────────────────────────
TARGET="$PET_DIR/$SAFE_NAME"
if [[ -e "$TARGET" ]]; then
  warn "$TARGET already exists; backing up to $TARGET.bak.$(date +%s)"
  mv "$TARGET" "$TARGET.bak.$(date +%s)"
fi
mkdir -p "$TARGET"

# Determine source image for spritesheet
SRC_IMAGE="$SOURCE"
if [[ "$BUNDLE_MODE" == true ]]; then
  if ! [[ -d "$SOURCE" ]]; then
    err "--bundle expects a directory, got: $SOURCE"
    exit 1
  fi
  # Pick the first PNG in the bundle as source
  SRC_IMAGE=$(find "$SOURCE" -maxdepth 1 -name "*.png" | head -1)
  if [[ -z "$SRC_IMAGE" ]]; then
    err "no PNG found in bundle directory: $SOURCE"
    exit 1
  fi
fi

step "Generating spritesheet (1536x1872) from $SRC_IMAGE"

"$PY" - "$SRC_IMAGE" "$TARGET" "$SAFE_NAME" "$DISPLAY_NAME" <<'PYEOF'
import sys, json, os
from PIL import Image

src_path, out_dir, pet_id, display_name = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

src = Image.open(src_path).convert("RGBA")

FRAME_W, FRAME_H = 192, 208
COLS, ROWS = 8, 9
sheet = Image.new("RGBA", (COLS * FRAME_W, ROWS * FRAME_H), (0, 0, 0, 0))

ratio = min((FRAME_W - 20) / src.width, (FRAME_H - 20) / src.height)
new_w, new_h = int(src.width * ratio), int(src.height * ratio)
resized = src.resize((new_w, new_h), Image.LANCZOS)

for row in range(ROWS):
    for col in range(COLS):
        x = col * FRAME_W + (FRAME_W - new_w) // 2
        y = row * FRAME_H + (FRAME_H - new_h) // 2 + 10
        sheet.paste(resized, (x, y), resized)

sheet.save(os.path.join(out_dir, "spritesheet.webp"), "WEBP", quality=90)

pet = {
    "id": pet_id,
    "displayName": display_name,
    "description": f"A custom pet: {display_name}",
    "spritesheetPath": "spritesheet.webp"
}
with open(os.path.join(out_dir, "pet.json"), "w", encoding="utf-8") as f:
    json.dump(pet, f, indent=2, ensure_ascii=False)

print(f"spritesheet.webp + pet.json created")
PYEOF

ok "installed → $TARGET/"

# ── final instructions ─────────────────────────────────────────────────────
cat <<EOF

${C_GRN}${C_BLD}✓ Pet installed:${C_RST} ${C_BLD}$TARGET${C_RST}

${C_BLD}Next steps:${C_RST}
  1. ${C_CYN}Fully quit Codex${C_RST} (system tray / menu bar → Quit, not just close window)
  2. Relaunch Codex
  3. Open the pet picker (e.g. /pet command, or settings → Pets)
  4. Select "${C_BLD}$DISPLAY_NAME${C_RST}"

If the new pet doesn't appear:
  - Confirm Codex's actual pets folder (check Codex's docs / app settings)
  - Move the directory at $TARGET to that folder manually

EOF
