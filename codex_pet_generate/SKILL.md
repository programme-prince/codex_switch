---
name: codex-pet-generate
description: Generate and install custom pets for Codex CLI / desktop app. Use when the user asks to generate a Codex pet, "/hatch" isn't working, the image generation tool isn't available, or wants to create a custom animated pet companion.
---

# codex-pet-generate — Codex Pet Generator

Generate custom pets for Codex when `/hatch` isn't available (e.g. when using non-OpenAI providers like MiMo or DeepSeek that don't have image generation).

## When to use

- User asks "how do I generate a Codex pet" / "/hatch isn't working"
- User wants a custom animated pet companion
- User hits error: `the image generation tool (image_gen) is not available in this environment`

## Quickstart

```bash
# 1. Generate pet image (free, no API key needed)
python3 codex_pet_generate/scripts/generate_pet.py \
    --description "a chubby cyberpunk axolotl coding hero" \
    --out ~/Downloads/my-pet.png

# 2. Install into Codex's pet folder (generates spritesheet.webp + pet.json)
bash codex_pet_generate/scripts/install_pet.sh ~/Downloads/my-pet.png "axolotl-coder" "Axolotl Coder"

# 3. Restart Codex completely and select the new pet from the pet menu
```

## Image generation backends

| Provider | Quality | Cost | Setup |
|---|---|---|---|
| `pollinations` (default) | ok | free | no setup |
| `gpt-image-1` | best | ~$0.04–0.17/image | needs `PET_OPENAI_API_KEY` |
| `replicate` | great (FLUX/SDXL) | ~$0.003/image | needs `REPLICATE_API_TOKEN` |
| `local-sd` | varies | free (after setup) | needs Automatic1111/ComfyUI |

```bash
# Free (default)
python3 codex_pet_generate/scripts/generate_pet.py --description "..." --out pet.png

# With OpenAI key for higher quality
export PET_OPENAI_API_KEY=sk-real-openai-key
python3 codex_pet_generate/scripts/generate_pet.py --description "..." --out pet.png
```

## Animated pets

Generate multiple poses and install as a bundle:

```bash
# Generate different poses
python3 codex_pet_generate/scripts/generate_pet.py --description "bunny sitting calmly" --out idle.png
python3 codex_pet_generate/scripts/generate_pet.py --description "bunny bouncing happily" --out working.png
python3 codex_pet_generate/scripts/generate_pet.py --description "bunny celebrating" --out done.png

# Install bundle
bash codex_pet_generate/scripts/install_pet.sh --bundle ./my-pet/ "my-pet" "My Pet"
```

## Pet format

Codex requires:
- `pet.json` — id, displayName, description, spritesheetPath
- `spritesheet.webp` — 1536×1872 spritesheet (8 cols × 9 rows, 192×208 per frame)

The install script handles this automatically.

## Pet folder location

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Codex/pets/` or `~/.codex/pets/` |
| Linux | `~/.config/Codex/pets/` or `~/.codex/pets/` |
| Windows | `%APPDATA%\Codex\pets\` or `~\.codex\pets\` |

## Don't use this skill for

- Configuring Codex (use `mimo2codex print-config` or `mimo2codex print-cc-switch`)
- Direct API calls to MiMo or DeepSeek (use the mimo2codex proxy instead)
