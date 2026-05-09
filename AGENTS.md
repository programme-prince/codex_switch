# Agent instructions for the mimo2codex repo

This repo is a local proxy that lets the latest OpenAI Codex CLI / desktop talk
to **Xiaomi MiMo** and **DeepSeek** by translating the Responses API to Chat
Completions API. When you (the agent) run inside Codex pointed at this proxy,
the chat backend is **MiMo or DeepSeek, not OpenAI** — adjust your assumptions accordingly.

## Hard rules

1. **Never `pip install openai` and never `import openai`.** This project
   intentionally avoids the OpenAI Python SDK. The user's API key is for
   MiMo or DeepSeek, not OpenAI — `openai` SDK calls would either fail
   authentication or hit endpoints that don't exist. The sandbox also blocks
   network installs.

2. **Never assume image generation is available natively.** Neither MiMo nor
   DeepSeek have an image generation endpoint. Codex's `/hatch` (which calls
   OpenAI's `gpt-image-1`) does not work. There is a ready-made workaround
   in `codex_pet_generate/`; use that instead of writing fresh code.

3. **Don't fight the sandbox by asking the user to install packages.** If you
   would normally write code that needs a Python dependency, first check
   `scripts/` — most things you need are already there using only
   stdlib (`urllib.request`, `json`, etc.). If you genuinely need a new
   dependency, say so explicitly with the user before adding code that
   depends on it.

## Where things are

- `src/` — TypeScript source for the mimo2codex proxy itself (Node 18+).
  Compiled to `dist/` via `npm run build`. Tests in `test/`.
- `scripts/` — bootstrap scripts and utilities (install.sh, install.ps1, mimo_chat.py).
- `codex_pet_generate/` — Codex pet generation and installation scripts.
  **This is where you should look first when the user asks for pet generation.**

## Specifically: generating a Codex pet

The user almost certainly hits this when they say "generate a pet" /
"`/hatch` doesn't work" / "the image generation tool isn't available". The
flow you should follow is **already implemented** — just invoke it, do not
rewrite it from scratch:

```bash
# 1. Generate the pet image. Uses free pollinations.ai by default.
python3 codex_pet_generate/scripts/generate_pet.py \
    --description "<short chibi pet description>" \
    --out /tmp/pet.png

# 2. Install into Codex's pet directory (probes macOS/Linux/Windows paths)
bash codex_pet_generate/scripts/install_pet.sh /tmp/pet.png "<pet-name>" "<Display Name>"
```

If the sandbox blocks the network call (Pollinations / OpenAI / Replicate),
do NOT respond with "please install openai". The correct response is:

> "I can't reach the network from inside the sandbox. Please run the
> following in a regular terminal (outside Codex), then tell me when it's
> done and I'll continue:
>
>     python3 codex_pet_generate/scripts/generate_pet.py --description "..." --out /tmp/pet.png
>     bash codex_pet_generate/scripts/install_pet.sh /tmp/pet.png "<pet-name>" "<Display Name>"
>
> No `pip install` is needed — the script uses only the Python standard
> library."

## When in doubt

- Read `README.md` (English) or `README.zh.md` (Chinese) for the proxy itself.
- Read `codex_pet_generate/SKILL.md` for the pet generation workflow.
- Both `node dist/cli.js print-config` and `node dist/cli.js print-cc-switch`
  emit ready-to-paste config snippets — prefer those over hand-crafting
  TOML / JSON.
