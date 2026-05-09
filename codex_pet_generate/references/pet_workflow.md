# Codex Pet generation workflow (the `/hatch` alternative)

`/hatch` inside Codex calls OpenAI's image generation API (`gpt-image-1`). When
Codex is pointed at MiMo (via mimo2codex), `/hatch` fails because MiMo doesn't
have an image generation endpoint and the `mimo2codex-local` placeholder key
isn't a real OpenAI key.

This doc shows you how to generate the pet **outside** of Codex and drop it in.

## TL;DR (only MiMo key required)

```bash
# No OpenAI key, no pip install — defaults to free Pollinations
python3 codex_pet_generate/scripts/generate_pet.py \
    --description "chibi cyberpunk axolotl with a laptop" \
    --out ~/Downloads/my-pet.png

bash codex_pet_generate/scripts/install_pet.sh ~/Downloads/my-pet.png "axolotl-coder"
# fully quit and relaunch Codex; pick the new pet from the picker
```

The script prints `[provider] auto → pollinations` to confirm the free path
is in use. For better quality, see "Image gen alternatives" below.

## TL;DR (with OpenAI key for higher quality)

```bash
export PET_OPENAI_API_KEY=sk-real-openai-key   # NOT mimo2codex-local
python3 codex_pet_generate/scripts/generate_pet.py \
    --reference path/to/source.jpg \
    --description "chibi cyberpunk axolotl with a laptop" \
    --out ~/Downloads/my-pet.png

bash codex_pet_generate/scripts/install_pet.sh ~/Downloads/my-pet.png "axolotl-coder"
```

`--reference` (image-to-image edit) only works with `gpt-image-1`.

## Pet folder location

Codex looks for custom pet bundles in these locations (it picks the first that exists):

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Codex/pets/` (desktop), or `~/Documents/Codex/pets/` (CLI dump) |
| Linux | `~/.config/Codex/pets/` or `~/.codex/pets/` |
| Windows | `%APPDATA%\Codex\pets\` |

The exact path depends on your Codex version. `install_pet.sh` will probe each
candidate and put the file in the first writable directory it finds, falling
back to `~/.codex/pets/` if none exist (creating it).

After install, **fully quit Codex** (system tray → Quit, not just close window)
and reopen — the picker will show the new entry.

## Pet bundle format

A Codex pet bundle is a small directory with two files:

```
my-pet/
├── pet.json           # id, displayName, description, spritesheetPath
└── spritesheet.webp   # 1536×1872 spritesheet (8 cols × 9 rows, 192×208 per frame)
```

`pet.json` schema:
```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "description": "A custom pet",
  "spritesheetPath": "spritesheet.webp"
}
```

`scripts/install_pet.sh` generates both files automatically from a single PNG.

> **Note:** This format is reverse-engineered from observed behavior and may
> evolve. If a future Codex version rejects the bundle, check the Codex docs at
> <https://developers.openai.com/codex/app/pets> (or run `/pet --debug` if such a
> flag exists in your version) to see the current schema, and update the script.

## Step-by-step

### 1. Pick a reference image

Anything works — a photo of yourself, a screenshot of a character, a logo.
gpt-image-1's edit mode will turn it into a chibi-style sticker. PNG or JPG,
recommended ≤ 4 MB.

If you don't have a reference image, skip `--reference` and gpt-image-1 will
generate from your text description alone.

### 2. Write a description

The "description" goes into the prompt. Use [assets/pet_prompt_template.md](../assets/pet_prompt_template.md)
for the proven pattern. In short:

> `chibi sticker of <subject>, <pose>, transparent background, soft cel-shading,
> playful, sticker outline, 1024x1024`

The script will wrap your description with the rest of the prompt automatically.

You can also have **MiMo write the description for you**:

```bash
python3 scripts/mimo_chat.py \
    --image path/to/source.jpg \
    "Describe this image as a 25-word chibi pet sticker prompt for an image generator. \
     Use this format: 'chibi sticker of {subject}, {pose}, transparent background, \
     soft cel-shading'."
```

Then paste the output as `--description`.

### 3. Generate states (single image vs animated)

The default `generate_pet.py` produces **one** PNG (idle). For an animated pet
with multiple states, run it 3 times with different action descriptions:

```bash
python3 codex_pet_generate/scripts/generate_pet.py \
    --reference src.jpg --description "chibi axolotl, calm, hands on lap" \
    --out idle.png

python3 codex_pet_generate/scripts/generate_pet.py \
    --reference src.jpg --description "chibi axolotl, typing on laptop, focused expression" \
    --out working.png

python3 codex_pet_generate/scripts/generate_pet.py \
    --reference src.jpg --description "chibi axolotl, hands raised in celebration, sparkles" \
    --out done.png
```

Then point `install_pet.sh` at the directory containing all three:

```bash
bash codex_pet_generate/scripts/install_pet.sh --bundle ./my-axolotl/ "axolotl-coder"
```

### 4. Restart Codex completely

This is the step people skip. Codex caches the pet list at startup:

- **CLI**: just exit and rerun `codex`
- **Desktop**: system tray / menu bar → **Quit** (not just close window). Relaunch.

### 5. Select the new pet

Open the pet picker (e.g. `/pet` slash command, or settings → Pets) and select
your new entry by the name you passed to `install_pet.sh`.

## Image gen alternatives (if you don't want to pay OpenAI)

The script supports `--provider`:

| Provider | Quality | Cost | Setup |
|---|---|---|---|
| `gpt-image-1` (default) | best | ~$0.04–0.17/image | needs OpenAI key |
| `pollinations` | ok | free | no setup |
| `replicate` | great (FLUX/SDXL) | ~$0.003/image | needs Replicate key |
| `local-sd` | varies | free (after setup) | needs Automatic1111/ComfyUI running locally |

Examples:

```bash
# Free, no key
python3 codex_pet_generate/scripts/generate_pet.py --provider pollinations \
    --description "..." --out pet.png

# Replicate FLUX-Schnell
export REPLICATE_API_TOKEN=r8_...
python3 codex_pet_generate/scripts/generate_pet.py --provider replicate \
    --description "..." --out pet.png

# Local Stable Diffusion (Automatic1111 with --api flag, default port 7860)
python3 codex_pet_generate/scripts/generate_pet.py --provider local-sd \
    --description "..." --out pet.png
```

## Troubleshooting

**"Authentication failed"**
You're using the placeholder `mimo2codex-local` key. Set `PET_OPENAI_API_KEY`
to a real OpenAI key for `gpt-image-1`. The MiMo key won't work for OpenAI's
image API.

**"Codex doesn't see my new pet"**
- Check the install path in the install script's output
- Fully quit & relaunch Codex (not just close the window)
- Make sure `pet.json` is valid JSON and `spritesheet.webp` is 1536×1872
- Try copying a built-in pet's directory and replacing the files to rule out
  schema drift

**"The image looks bad / off-character"**
- Iterate on the description with MiMo: "Improve this image-gen prompt for a
  chibi pet sticker"
- For gpt-image-1, add `quality: "hd"` (script default is `medium`); pass
  `--quality hd` for the high-quality 1024×1024 path
- For consistency across states, use `--reference` so all three calls edit the
  same source image instead of generating from scratch
