# Pet prompt templates

Tuned for the chibi / sticker style Codex's built-in pets use. `generate_pet.py`
auto-prepends and appends the boilerplate, so what you pass via `--description`
should just be the **subject** (and optionally an action / pose for state-aware
variants).

The full assembled prompt looks like:

```
Chibi sticker mascot of <description>, <action>, front-facing, expressive face,
soft cel-shading, thin clean outline, transparent background, high detail,
playful, single character centered, 1024x1024 sticker style
```

## Subject formula

```
<adjective> <species/character> <(optional) accessory or trait>
```

Examples:

| Description | Result style |
|---|---|
| `chubby cyberpunk axolotl` | rounder body, neon highlights |
| `wise old shiba inu wearing tiny glasses` | classic dev mascot vibe |
| `tiny astronaut cat with a USB cable tail` | sci-fi quirky |
| `pixel-art slime in a hoodie` | indie game feel |
| `red panda with antennae and a debugger sword` | combat-coder mood |
| `kawaii rubber duck with a tie and laptop` | corporate-debug humor |

Tips:
- **One creature only.** "axolotl AND a cat" produces clutter.
- **Keep adjectives concrete.** "soft", "round", "tiny", "neon", "glowing" >
  "cool", "epic", "amazing".
- **Mention 1 accessory max.** A laptop, a coffee cup, a wrench — not all three.

## State action overrides (for `--bundle` mode)

These are inserted between subject and the boilerplate, replacing the script's
default actions if you customize.

| State | Default action |
|---|---|
| `idle` | `calm pose, hands together, soft smile` |
| `working` | `typing on a tiny laptop, focused expression, sparkles around hands` |
| `done` | `celebrating with arms raised, sparkles and confetti` |

Custom action examples:

- working: `welding sparks flying, goggles down, intense concentration`
- done: `triumphantly holding up a 'shipped' flag, confetti raining`
- error: `comedic stunned face, smoke wisps, holding a broken keyboard`

## Generating descriptions with MiMo

Have MiMo describe the reference image first:

```bash
python3 scripts/mimo_chat.py \
    --image path/to/reference.jpg \
    "Describe this character in 12-25 words as a chibi pet sticker prompt for \
     image generation. Output ONLY the description, no preamble. Format: \
     '<adjective> <species> <accessory>'."
```

Pipe it straight into the generator:

```bash
DESC=$(python3 scripts/mimo_chat.py --image src.jpg \
    "Describe this character in 12-25 words ... Output ONLY the description.")
python3 codex_pet_generate/scripts/generate_pet.py \
    --reference src.jpg --description "$DESC" --bundle ./my-pet/
```

## Style overrides

If the default chibi-sticker style isn't what you want, edit
`scripts/generate_pet.py` and change `PROMPT_PREFIX` / `PROMPT_SUFFIX`. Common
alternatives:

- **Pixel art**: prefix `Retro 16-bit pixel art sprite of `, suffix `, transparent background, single sprite, 64x64 upscaled to 1024x1024 with nearest-neighbor`
- **Hand-drawn**: prefix `Hand-drawn ink-and-watercolor sticker of `, suffix `, transparent background, loose linework, watercolor wash, single character`
- **3D rendered**: prefix `Cute 3D render mascot of `, suffix `, soft global illumination, transparent background, octane render, isometric three-quarter view`

## Anti-patterns

These tend to produce bad pets — avoid:

- Listing more than 3 visual traits in the subject (model averages them poorly)
- Naming a real human ("looks like Steve Jobs") — gpt-image-1 will refuse
- Negative prompts in the description ("not blurry") — handled by the suffix
- Specifying impossible camera angles ("from below") for sticker-style outputs
