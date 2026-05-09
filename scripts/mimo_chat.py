#!/usr/bin/env python3
"""
mimo_chat.py — single-shot or streaming chat with Xiaomi MiMo V2.5.

Hits MiMo's OpenAI-compatible /v1/chat/completions endpoint directly. Handles
the MiMo-specific quirks:

  - max_completion_tokens (not max_tokens)
  - vision via mimo-v2.5 / mimo-v2-omni (and the required text part next to
    image_url, otherwise MiMo 400s with "text is not set")
  - web_search builtin tool (requires Web Search Plugin activated in console)
  - reasoning_content extraction

Usage:
    export MIMO_API_KEY=sk-xxxx
    python3 mimo_chat.py "your prompt"
    python3 mimo_chat.py --model mimo-v2.5 --image https://x/y.png "describe"
    python3 mimo_chat.py --search "今天上海天气?"
    python3 mimo_chat.py --stream "tell me a story"

Only depends on the standard library — no `openai` SDK install needed.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from typing import Any


def build_messages(prompt: str, image: str | None) -> list[dict[str, Any]]:
    if image is None:
        return [{"role": "user", "content": prompt}]
    # MiMo requires BOTH image_url and a text part — sending image-only returns
    # 400 "Param Incorrect: `text` is not set". If the user gave no prompt,
    # fall back to a single space (the model will infer intent from the image).
    return [
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": image}},
                {"type": "text", "text": prompt or " "},
            ],
        }
    ]


def build_body(
    *,
    prompt: str,
    image: str | None,
    model: str,
    stream: bool,
    search: bool,
    max_tokens: int,
    temperature: float,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "messages": build_messages(prompt, image),
        "max_completion_tokens": max_tokens,
        "temperature": temperature,
        "stream": stream,
    }
    if search:
        # MiMo native web_search builtin. Requires the Web Search Plugin to
        # be activated at https://platform.xiaomimimo.com/#/console/plugin.
        body["tools"] = [{"type": "web_search", "force_search": True}]
        body["tool_choice"] = "auto"
    return body


def post(url: str, body: dict[str, Any], api_key: str, stream: bool) -> Any:
    req = urllib.request.Request(
        url,
        method="POST",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream" if stream else "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "mimo2codex/0.1",
        },
    )
    try:
        return urllib.request.urlopen(req, timeout=300)
    except urllib.error.HTTPError as e:
        snippet = e.read().decode("utf-8", "replace")
        sys.stderr.write(f"MiMo returned HTTP {e.code}: {snippet}\n")
        sys.exit(1)
    except urllib.error.URLError as e:
        sys.stderr.write(f"connection failed: {e}\n")
        sys.exit(1)


def stream_chat(resp: Any) -> None:
    annotations: list[dict[str, Any]] = []
    for raw in resp:
        line = raw.decode("utf-8", "replace").strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        try:
            chunk = json.loads(data)
        except json.JSONDecodeError:
            continue
        choice = chunk.get("choices", [{}])[0]
        delta = choice.get("delta", {})
        for ann in delta.get("annotations") or []:
            annotations.append(ann)
        # Print reasoning_content dimly to stderr, content to stdout
        if r := delta.get("reasoning_content"):
            sys.stderr.write(r)
            sys.stderr.flush()
        if c := delta.get("content"):
            sys.stdout.write(c)
            sys.stdout.flush()
    sys.stdout.write("\n")
    if annotations:
        sys.stderr.write("\n--- citations ---\n")
        for a in annotations:
            sys.stderr.write(f"  • {a.get('title', '(no title)')}\n    {a.get('url')}\n")


def non_stream_chat(resp: Any) -> None:
    payload = json.loads(resp.read().decode("utf-8"))
    msg = payload["choices"][0]["message"]
    if reasoning := msg.get("reasoning_content"):
        sys.stderr.write(f"[reasoning]\n{reasoning}\n[/reasoning]\n\n")
    print(msg.get("content") or "")
    if anns := msg.get("annotations"):
        sys.stderr.write("\n--- citations ---\n")
        for a in anns:
            sys.stderr.write(f"  • {a.get('title', '(no title)')}\n    {a.get('url')}\n")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    p.add_argument("prompt", nargs="?", default="", help="user message text")
    p.add_argument("--model", default=os.environ.get("MIMO_MODEL", "mimo-v2.5-pro"))
    p.add_argument("--image", help="image URL to attach (forces vision-capable model)")
    p.add_argument("--search", action="store_true", help="enable MiMo web_search builtin")
    p.add_argument("--stream", action="store_true", help="stream the response")
    p.add_argument("--max-tokens", type=int, default=2048)
    p.add_argument("--temperature", type=float, default=0.7)
    p.add_argument(
        "--base-url",
        default=os.environ.get("MIMO_BASE_URL", "https://api.xiaomimimo.com/v1"),
        help="set to https://token-plan-cn.xiaomimimo.com/v1 for tp-* keys",
    )
    args = p.parse_args()

    api_key = os.environ.get("MIMO_API_KEY")
    if not api_key:
        sys.stderr.write("error: MIMO_API_KEY not set in environment\n")
        sys.stderr.write(
            "  get one at https://platform.xiaomimimo.com/#/console/api-keys\n"
        )
        sys.exit(2)

    if not args.prompt and not args.image:
        sys.stderr.write("error: pass a prompt and/or --image\n")
        sys.exit(2)

    # Auto-bump to a vision model if user passed --image with a non-vision model
    model = args.model
    if args.image and "omni" not in model.lower() and not model.startswith("mimo-v2.5["):
        if model != "mimo-v2.5":
            sys.stderr.write(
                f"note: --image given but model is '{model}' which doesn't see images.\n"
                f"      switching to mimo-v2.5 for this call.\n"
            )
            model = "mimo-v2.5"

    body = build_body(
        prompt=args.prompt,
        image=args.image,
        model=model,
        stream=args.stream,
        search=args.search,
        max_tokens=args.max_tokens,
        temperature=args.temperature,
    )

    url = args.base_url.rstrip("/") + "/chat/completions"
    resp = post(url, body, api_key, args.stream)
    if args.stream:
        stream_chat(resp)
    else:
        non_stream_chat(resp)


if __name__ == "__main__":
    main()
