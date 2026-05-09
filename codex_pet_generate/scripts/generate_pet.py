#!/usr/bin/env python3
"""
generate_pet.py — produce a Codex pet sprite outside Codex.

Codex's `/hatch` requires OpenAI's image generation API (gpt-image-1). MiMo
doesn't have an image gen endpoint and mimo2codex can't fake one, so when
Codex is pointed at MiMo, /hatch fails. This script generates the pet sprite
using your choice of provider, then `install_pet.sh` drops it into Codex's
pet directory.

Providers:
  auto (default)        — gpt-image-1 if PET_OPENAI_API_KEY/OPENAI_API_KEY is set,
                          otherwise falls back to pollinations (free, no key).
                          Pick this if you only have a MiMo key and want pet
                          generation to "just work".
  pollinations          — free, no key. Decent quality for chibi-sticker style.
  gpt-image-1           — best quality, needs PET_OPENAI_API_KEY (real OpenAI key,
                          NOT the mimo2codex-local placeholder). Image-to-image
                          edit (--reference) only works with this provider.
  replicate             — FLUX/SDXL, needs REPLICATE_API_TOKEN. Cheap (~$0.003/img).
  local-sd              — local Automatic1111 / ComfyUI on http://127.0.0.1:7860, free.

Usage:
    # auto mode — works with ONLY a MiMo key (no OpenAI key needed)
    python3 generate_pet.py --description "chibi axolotl" --out pet.png

    # explicit free path
    python3 generate_pet.py --provider pollinations --description "..." --out pet.png

    # best quality (needs OpenAI key, separate from MIMO_API_KEY)
    export PET_OPENAI_API_KEY=sk-real-openai-key
    python3 generate_pet.py --provider gpt-image-1 \\
        --reference src.jpg --description "chibi axolotl" --out pet.png

    # bundle of three states (idle / working / done)
    python3 generate_pet.py --description "chibi axolotl" --bundle ./my-pet/
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

# --- prompt assembly --------------------------------------------------------

PROMPT_PREFIX = (
    "Chibi sticker mascot of "
)
PROMPT_SUFFIX = (
    ", front-facing, expressive face, soft cel-shading, thin clean outline, "
    "transparent background, high detail, playful, single character centered, "
    "1024x1024 sticker style"
)


def build_prompt(description: str, action: str | None = None) -> str:
    body = description.strip().rstrip(".,;")
    if action:
        body += f", {action}"
    return PROMPT_PREFIX + body + PROMPT_SUFFIX


# --- providers --------------------------------------------------------------

def _http_post_json(url: str, body: dict, headers: dict) -> dict:
    req = urllib.request.Request(
        url,
        method="POST",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        snippet = e.read().decode("utf-8", "replace")
        raise SystemExit(f"HTTP {e.code} from {url}: {snippet}")


def _http_get_bytes(url: str, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} fetching {url}")


def _multipart_post(
    url: str, fields: dict[str, str], files: dict[str, tuple[str, bytes, str]], headers: dict
) -> dict:
    """Minimal multipart/form-data POST (for OpenAI image edits endpoint)."""
    boundary = "----mimoskill" + os.urandom(8).hex()
    body = bytearray()
    for k, v in fields.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode()
        body += v.encode() + b"\r\n"
    for k, (filename, data, mime) in files.items():
        body += f"--{boundary}\r\n".encode()
        body += (
            f'Content-Disposition: form-data; name="{k}"; filename="{filename}"\r\n'
        ).encode()
        body += f"Content-Type: {mime}\r\n\r\n".encode()
        body += data + b"\r\n"
    body += f"--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        url,
        method="POST",
        data=bytes(body),
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            **headers,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        snippet = e.read().decode("utf-8", "replace")
        raise SystemExit(f"HTTP {e.code}: {snippet}")


def gen_gpt_image_1(prompt: str, reference: Path | None, quality: str, out: Path) -> None:
    api_key = os.environ.get("PET_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit(
            "error: PET_OPENAI_API_KEY (or OPENAI_API_KEY) is not set.\n"
            "       gpt-image-1 needs a real OpenAI key — the mimo2codex-local "
            "placeholder won't work.\n"
            "       Get one at https://platform.openai.com/api-keys, or use "
            "--provider pollinations for free."
        )

    if reference and reference.exists():
        # Edit mode — preserve the reference image's likeness
        url = "https://api.openai.com/v1/images/edits"
        mime = mimetypes.guess_type(reference.name)[0] or "image/png"
        result = _multipart_post(
            url,
            fields={
                "model": "gpt-image-1",
                "prompt": prompt,
                "size": "1024x1024",
                "quality": quality,
                "n": "1",
            },
            files={"image[]": (reference.name, reference.read_bytes(), mime)},
            headers={"Authorization": f"Bearer {api_key}"},
        )
    else:
        # Pure generation
        url = "https://api.openai.com/v1/images/generations"
        result = _http_post_json(
            url,
            {
                "model": "gpt-image-1",
                "prompt": prompt,
                "size": "1024x1024",
                "quality": quality,
                "n": 1,
            },
            headers={"Authorization": f"Bearer {api_key}"},
        )

    item = result["data"][0]
    if "b64_json" in item:
        out.write_bytes(base64.b64decode(item["b64_json"]))
    elif "url" in item:
        out.write_bytes(_http_get_bytes(item["url"]))
    else:
        raise SystemExit(f"unexpected response shape: {result}")


def gen_pollinations(prompt: str, out: Path) -> None:
    # Free, no API key. Lower quality but no setup.
    url = (
        "https://image.pollinations.ai/prompt/"
        + urllib.parse.quote(prompt)
        + "?width=1024&height=1024&nologo=true&model=flux"
    )
    out.write_bytes(_http_get_bytes(url, headers={"User-Agent": "mimoskill/0.1"}))


def gen_replicate(prompt: str, out: Path) -> None:
    token = os.environ.get("REPLICATE_API_TOKEN")
    if not token:
        raise SystemExit("error: REPLICATE_API_TOKEN not set")

    # FLUX-Schnell is fastest & cheapest on Replicate as of writing.
    create = _http_post_json(
        "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
        {"input": {"prompt": prompt, "aspect_ratio": "1:1", "output_format": "png"}},
        headers={"Authorization": f"Bearer {token}", "Prefer": "wait"},
    )
    output = create.get("output")
    # Replicate returns either a URL or list of URLs; with Prefer:wait, the
    # response should already include the final result.
    if isinstance(output, list):
        url = output[0]
    elif isinstance(output, str):
        url = output
    else:
        # Fall back to polling
        get_url = create["urls"]["get"]
        for _ in range(60):
            time.sleep(1)
            poll = json.loads(
                _http_get_bytes(get_url, headers={"Authorization": f"Bearer {token}"})
            )
            if poll["status"] == "succeeded":
                url = poll["output"][0] if isinstance(poll["output"], list) else poll["output"]
                break
            if poll["status"] in {"failed", "canceled"}:
                raise SystemExit(f"replicate prediction {poll['status']}: {poll.get('error')}")
        else:
            raise SystemExit("replicate prediction timed out")
    out.write_bytes(_http_get_bytes(url))


def gen_local_sd(prompt: str, out: Path, host: str = "http://127.0.0.1:7860") -> None:
    # Targets Automatic1111's /sdapi/v1/txt2img. ComfyUI users should swap
    # this out for /prompt and adapt accordingly.
    result = _http_post_json(
        host.rstrip("/") + "/sdapi/v1/txt2img",
        {
            "prompt": prompt,
            "steps": 25,
            "width": 1024,
            "height": 1024,
            "cfg_scale": 7,
            "sampler_name": "Euler",
        },
        headers={},
    )
    images = result.get("images") or []
    if not images:
        raise SystemExit(f"local-sd returned no image: {result}")
    out.write_bytes(base64.b64decode(images[0]))


PROVIDERS = {
    "gpt-image-1": gen_gpt_image_1,
    "pollinations": gen_pollinations,
    "replicate": gen_replicate,
    "local-sd": gen_local_sd,
}


def resolve_auto_provider() -> str:
    """Pick the best provider that's actually usable in the current env."""
    if os.environ.get("PET_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY"):
        return "gpt-image-1"
    if os.environ.get("REPLICATE_API_TOKEN"):
        return "replicate"
    # Pollinations needs nothing — guaranteed fallback.
    return "pollinations"

# --- cli --------------------------------------------------------------------

def generate_one(
    provider: str, prompt: str, reference: Path | None, quality: str, out: Path
) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    fn = PROVIDERS[provider]
    if provider == "gpt-image-1":
        fn(prompt, reference, quality, out)
    else:
        # Other providers don't support reference / edit mode here; the prompt
        # is the only signal. Reference is ignored with a notice.
        if reference is not None:
            sys.stderr.write(
                f"note: provider '{provider}' doesn't support --reference; ignoring.\n"
                "      Only gpt-image-1 supports image-to-image edit in this script.\n"
            )
        fn(prompt, out)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    p.add_argument("--description", required=True, help="what the pet looks/acts like")
    p.add_argument("--reference", type=Path, help="reference image (gpt-image-1 only)")
    p.add_argument(
        "--provider",
        choices=["auto"] + list(PROVIDERS),
        default="auto",
        help="image gen backend. 'auto' picks gpt-image-1 if you have an OpenAI "
        "key, else falls back to pollinations (free, no key). With only a MiMo "
        "key, 'auto' will use pollinations.",
    )
    p.add_argument("--quality", default="medium", choices=["low", "medium", "high", "hd"])
    p.add_argument("--out", type=Path, help="single-image output path (PNG)")
    p.add_argument(
        "--bundle",
        type=Path,
        help="generate idle/working/done into a directory and write a manifest.json stub",
    )
    args = p.parse_args()

    if not args.out and not args.bundle:
        sys.stderr.write("error: pass either --out FILE or --bundle DIR\n")
        sys.exit(2)
    if args.out and args.bundle:
        sys.stderr.write("error: --out and --bundle are mutually exclusive\n")
        sys.exit(2)

    # Resolve --provider auto → concrete provider, with a status line so the
    # user knows what they're getting.
    if args.provider == "auto":
        chosen = resolve_auto_provider()
        if chosen == "pollinations":
            sys.stderr.write(
                "[provider] auto → pollinations (free, no key required).\n"
                "           For higher quality, set PET_OPENAI_API_KEY (real OpenAI key)\n"
                "           and rerun, or pass --provider replicate / local-sd.\n\n"
            )
        else:
            sys.stderr.write(f"[provider] auto → {chosen}\n\n")
        args.provider = chosen

    if args.bundle:
        states = {
            "idle": "calm pose, hands together, soft smile",
            "working": "typing on a tiny laptop, focused expression, sparkles around hands",
            "done": "celebrating with arms raised, sparkles and confetti",
        }
        args.bundle.mkdir(parents=True, exist_ok=True)
        for state, action in states.items():
            out = args.bundle / f"{state}.png"
            prompt = build_prompt(args.description, action)
            sys.stderr.write(f"[{state}] generating → {out}\n")
            generate_one(args.provider, prompt, args.reference, args.quality, out)
        # Stub manifest — install_pet.sh will overwrite with the user's name
        manifest = {
            "version": 1,
            "name": "custom-pet",
            "states": {state: f"{state}.png" for state in states},
        }
        (args.bundle / "manifest.json").write_text(json.dumps(manifest, indent=2))
        sys.stderr.write(f"\n✓ bundle written to {args.bundle}\n")
        sys.stderr.write(
            f"  next: bash install_pet.sh --bundle {args.bundle} <pet-name>\n"
        )
    else:
        prompt = build_prompt(args.description)
        sys.stderr.write(f"generating → {args.out}\n")
        sys.stderr.write(f"prompt: {prompt}\n")
        generate_one(args.provider, prompt, args.reference, args.quality, args.out)
        sys.stderr.write(f"\n✓ wrote {args.out}\n")
        sys.stderr.write(
            f"  next: bash install_pet.sh {args.out} <pet-name>\n"
        )


if __name__ == "__main__":
    main()
