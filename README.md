# mimo2codex

> English · [中文文档](./README.zh.md)

Local proxy that lets the **latest OpenAI Codex CLI** and **Codex desktop app** talk to **Xiaomi MiMo** and **DeepSeek** by translating Codex's Responses API ↔ Chat Completions API on the fly. Works standalone, or as a custom Codex provider in [cc-switch](https://github.com/farion1231/cc-switch) — switch between providers with one click.

> **Note:** Codex's built-in `/hatch` pet generation requires OpenAI's image generation API and won't work with this proxy. We provide an alternative that generates custom pets for free, see [`codex_pet_generate/`](./codex_pet_generate/).

## What it does

Codex uses OpenAI's Responses API, but MiMo and DeepSeek only support Chat Completions. This proxy translates protocols in real-time:

```
Codex CLI / Desktop → Responses API → mimo2codex proxy → Chat Completions API → MiMo / DeepSeek
```

## What works

- ✅ Codex CLI / desktop app (macOS / Windows)
- ✅ Pet companion, tool calling (including parallel), multi-turn conversations
- ✅ Streaming SSE with full Responses event schema
- ✅ Thinking mode passthrough (reasoning_content)
- ✅ MiMo Web Search translation
- ✅ Multiple providers (MiMo / DeepSeek)
- ✅ cc-switch integration

---

## Quick Start

### Option 1: Using cc-switch (Recommended)

cc-switch is a desktop app that manages multiple Codex providers and lets you switch between them with one click. **This is the recommended approach** because:
- It doesn't overwrite your existing OpenAI configuration
- You can switch between MiMo, DeepSeek, and OpenAI freely
- Configuration is simpler — just paste and go

#### Step 1: Install mimo2codex

```bash
npm install -g mimo2codex
```

Requires Node.js ≥ 18.

#### Step 2: Start the proxy

Open a terminal window and start the proxy (it must keep running):

**MiMo (Token Plan):**
```bash
MIMO_API_KEY=tp-xxx mimo2codex --base-url https://token-plan-cn.xiaomimimo.com/v1 --no-web-search
```

**MiMo (Pay-as-you-go):**
```bash
MIMO_API_KEY=sk-xxx mimo2codex
```

**DeepSeek:**
```bash
DEEPSEEK_API_KEY=sk-xxx mimo2codex --provider deepseek
```

**Run both providers simultaneously (different ports):**
```bash
# Terminal 1 — MiMo
MIMO_API_KEY=tp-xxx mimo2codex --base-url https://token-plan-cn.xiaomimimo.com/v1 --no-web-search --port 8788

# Terminal 2 — DeepSeek
DEEPSEEK_API_KEY=sk-xxx mimo2codex --provider deepseek --port 8789
```

On Windows, use `start_all_proxies.bat` in the repo root to launch both at once.

When successful, the terminal shows:
```
mimo2codex listening on http://127.0.0.1:8788
```

#### Step 3: Get cc-switch configuration

In **another terminal**, run:

```bash
# For MiMo
mimo2codex print-cc-switch

# Or for DeepSeek
mimo2codex --provider deepseek --port 8789 print-cc-switch
```

This outputs something like:
```
# ───────── auth.json ─────────
{
  "OPENAI_API_KEY": "mimo2codex-local"
}

# ───────── config.toml ─────────
model_provider = "mimo2codex"
model = "mimo-v2.5-pro"

[model_providers.mimo2codex]
name = "MiMo (via mimo2codex)"
base_url = "http://127.0.0.1:8788/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
```

#### Step 4: Add provider in cc-switch

1. Open the cc-switch app
2. Click **Add Provider** → Select **Codex** tab → Click **Custom**
3. **auth.json textarea**: Paste the auth.json content from above
4. **config.toml textarea**: Paste the config.toml content from above
5. Click Save

#### Step 5: Switch and use

1. In cc-switch, select the provider you just added (e.g., "MiMo (via mimo2codex)")
2. cc-switch automatically writes `~/.codex/auth.json` and `~/.codex/config.toml`
3. **Fully quit Codex desktop** (system tray → Quit, not just close window)
4. Restart Codex
5. **Turn off VPN** (if you have it on)
6. Codex is now using MiMo/DeepSeek!

**Why turn off VPN?** Codex needs VPN to connect to `auth.openai.com` for authentication (in China), but after authentication, the proxy connects to MiMo/DeepSeek directly (no VPN needed). If VPN stays on, it may intercept local traffic on `127.0.0.1`, causing connection failures or frequent reconnects.

To switch back to OpenAI, just select OpenAI in cc-switch — no manual config editing needed.

---

### Option 2: Direct configuration (without cc-switch)

If you prefer not to use cc-switch, you can edit the config files directly. **Note: This will overwrite your existing OpenAI configuration.**

#### Step 1: Install mimo2codex

```bash
npm install -g mimo2codex
```

#### Step 2: Start the proxy

Same as above — start the proxy in a terminal.

#### Step 3: Generate configuration

```bash
mimo2codex print-config
```

The output tells you what to write:
```
# Step 1 — write ~/.codex/auth.json
{
  "OPENAI_API_KEY": "mimo2codex-local"
}

# Step 2 — append to ~/.codex/config.toml
model = "mimo-v2.5-pro"
model_provider = "mimo"

[model_providers.mimo]
name = "MiMo (via mimo2codex)"
base_url = "http://127.0.0.1:8788/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
```

#### Step 4: Write the config files

**Windows paths:**
- `C:\Users\YourUsername\.codex\auth.json`
- `C:\Users\YourUsername\.codex\config.toml`

**macOS / Linux paths:**
- `~/.codex/auth.json`
- `~/.codex/config.toml`

Write the content to the corresponding files as shown. Create files if they don't exist, or overwrite/append if they do.

#### Step 5: Restart Codex

Fully quit Codex desktop (system tray → Quit) and restart it.

---

## Available Models

| Provider | Model | Notes |
|---|---|---|
| **MiMo** | `mimo-v2.5-pro` | Default, strong reasoning |
| **MiMo** | `mimo-v2.5-pro[1m]` | 1M context window |
| **MiMo** | `mimo-v2.5` | Supports image input |
| **MiMo** | `mimo-v2.5[1m]` | Vision + 1M context |
| **DeepSeek** | `deepseek-v4-flash` | Default, fast |
| **DeepSeek** | `deepseek-v4-flash[1m]` | 1M context window |
| **DeepSeek** | `deepseek-v4-pro` | Pro version |
| **DeepSeek** | `deepseek-v4-pro[1m]` | Pro + 1M context |
| **DeepSeek** | `deepseek-chat` | DeepSeek V3 |
| **DeepSeek** | `deepseek-reasoner` | R1 reasoning model |

> The `[1m]` suffix indicates 1M context window. The proxy automatically strips this suffix before calling the upstream API.

---

## CLI Reference

| Flag | Env | Default | Notes |
|---|---|---|---|
| `--provider` | `MIMO2CODEX_PROVIDER` | `mimo` | Upstream provider (`mimo` / `deepseek`) |
| `--model` | — | provider default | Override default model |
| `-p, --port` | `MIMO2CODEX_PORT` | `8788` | Listen port |
| `--host` | `MIMO2CODEX_HOST` | `127.0.0.1` | Bind host |
| `--base-url` | — | provider default | Override upstream API URL |
| `--api-key` | see below | — | Override API key |
| `--no-web-search` | `MIMO2CODEX_NO_WEB_SEARCH` | off | Strip web_search tools |
| `--no-reasoning` | `MIMO2CODEX_NO_REASONING` | off | Hide reasoning from Codex |
| `-v, --verbose` | `MIMO2CODEX_VERBOSE` | off | Log every request |

API Key environment variables:

| Provider | Env var |
|---|---|
| MiMo | `MIMO_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |

Subcommands:

```bash
mimo2codex print-config             # Print Codex config snippet
mimo2codex print-cc-switch          # Print cc-switch config snippet
```

---

## Get API Keys

**MiMo:** [platform.xiaomimimo.com](https://platform.xiaomimimo.com) → Console → API Keys
- `sk-xxx` (pay-as-you-go) → default base URL
- `tp-xxx` (Token Plan) → `--base-url https://token-plan-cn.xiaomimimo.com/v1`

**DeepSeek:** [platform.deepseek.com](https://platform.deepseek.com) → API Keys

---

## Troubleshooting

**Codex hangs / 504 / connection refused**
1. Check the proxy is still running (terminal window not closed)
2. Test proxy health: `curl http://127.0.0.1:8788/healthz` should return `{"ok":true,...}`
3. config.toml `base_url` must end with `/v1`

**401 / authentication_error**
API key is invalid. Create a new one at the provider's console.

**MiMo 400: web search tool found but webSearchEnabled is false**
Enable Web Search plugin in [MiMo console → Plugin Management](https://platform.xiaomimimo.com/#/console/plugin), or start with `--no-web-search`.

**VPN issues**
- Codex desktop needs to reach `auth.openai.com` for authentication (requires VPN in China)
- The proxy connects to MiMo/DeepSeek directly (no VPN needed)
- **Correct flow: VPN on → start Codex → authentication done → VPN off → use normally**
- If VPN stays on, it intercepts `127.0.0.1` local traffic, causing connection failures or frequent reconnects
- Configure VPN to bypass `127.0.0.1`

**After switching in cc-switch, Codex doesn't change**
- Make sure to fully quit Codex (system tray → Quit), not just close the window
- Restart Codex

---

## Project Structure

```
mimo2codex/
├── src/
│   ├── cli.ts              # Entry: argv parsing, server boot
│   ├── server.ts           # HTTP server: /v1/responses, /v1/models, /healthz
│   ├── config.ts           # Provider presets, env + flags
│   ├── upstream/
│   │   ├── mimoClient.ts   # Upstream fetch wrapper
│   │   └── chatStream.ts   # SSE stream parser
│   ├── translate/
│   │   ├── types.ts        # Type definitions
│   │   ├── reqToChat.ts    # Request translation (Responses → Chat)
│   │   ├── respToResponses.ts  # Response translation (non-stream)
│   │   └── streamToSse.ts  # Streaming state machine
│   └── util/
├── test/
├── scripts/
│   ├── install.sh          # Install script
│   ├── install.ps1         # Windows install script
│   └── mimo_chat.py        # MiMo API debug tool
├── codex_pet_generate/     # Codex pet generation
├── start_all_proxies.bat   # Windows one-click start
├── stop_all_proxies.bat    # Windows one-click stop
└── package.json
```

## License

MIT
