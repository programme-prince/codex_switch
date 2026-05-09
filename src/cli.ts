#!/usr/bin/env node
import { buildConfig, parseArgv, PRESETS, PROVIDER_NAMES, type Config, type ProviderPreset } from "./config.js";
import { startServer } from "./server.js";
import { setVerbose, log, redactKey } from "./util/log.js";

const VERSION = "0.1.0";

const HELP = `mimo2codex v${VERSION} — local proxy: Codex Responses API → Chat Completions

USAGE
  mimo2codex [options]
  mimo2codex print-config
  mimo2codex print-cc-switch

OPTIONS
  -p, --port <n>          listen port (default: 8788, env: MIMO2CODEX_PORT)
      --host <h>          bind host (default: 127.0.0.1, env: MIMO2CODEX_HOST)
      --provider <name>   upstream provider: ${PROVIDER_NAMES.join(", ")} (default: mimo, env: MIMO2CODEX_PROVIDER)
      --base-url <url>    override provider base url
      --api-key <key>     override api key (env: see provider defaults)
      --model <name>      override default model for the selected provider
      --no-reasoning      hide reasoning_content from Codex (still re-injected for multi-turn quality)
      --reasoning         force reasoning passthrough (default)
      --no-web-search     strip web_search tools from requests (env: MIMO2CODEX_NO_WEB_SEARCH=1)
  -v, --verbose           log every request (env: MIMO2CODEX_VERBOSE=1)
  -V, --version           print version
  -h, --help              show this help

SUBCOMMANDS
  print-config            print ~/.codex/auth.json + config.toml snippets (default;
                          works for Codex CLI and desktop app)
  print-config --env-key  print env-var-based variant (Codex CLI only — desktop app
                          will NOT see shell env vars set via export/setx)
  print-cc-switch         print auth.json + config.toml snippets for the cc-switch
                          desktop app (https://github.com/farion1231/cc-switch)

EXAMPLES
  # MiMo (default)
  MIMO_API_KEY=tp-... mimo2codex
  mimo2codex --base-url https://token-plan-cn.xiaomimimo.com/v1

  # DeepSeek
  DEEPSEEK_API_KEY=sk-... mimo2codex --provider deepseek
  DEEPSEEK_API_KEY=sk-... mimo2codex --provider deepseek --model deepseek-chat

  # Print config for different providers
  mimo2codex --provider deepseek print-config
  mimo2codex --provider deepseek print-cc-switch
`;

function resolvePreset(providerName: string): ProviderPreset {
  const preset = PRESETS[providerName];
  if (!preset) {
    throw new Error(`unknown provider "${providerName}" — available: ${PROVIDER_NAMES.join(", ")}`);
  }
  return preset;
}

// Default snippet — uses ~/.codex/auth.json + requires_openai_auth = true.
function configSnippet(cfg: { host: string; port: number }, preset: ProviderPreset): string {
  const providerKey = preset === PRESETS.mimo ? "mimo" : preset.name.toLowerCase();
  return `# Step 1 — write ~/.codex/auth.json (Windows: %USERPROFILE%\\.codex\\auth.json)
# Any non-empty value works; mimo2codex does not validate inbound credentials.
{
  "OPENAI_API_KEY": "mimo2codex-local"
}

# Step 2 — append to ~/.codex/config.toml (Windows: %USERPROFILE%\\.codex\\config.toml)
model = "${preset.defaultModel}"
model_provider = "${providerKey}"

[model_providers.${providerKey}]
name = "${preset.name} (via mimo2codex)"
base_url = "http://${cfg.host}:${cfg.port}/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1

# Step 3 — completely quit and restart Codex (the desktop app must be relaunched
# for the new auth.json to be picked up). Then run \`codex\` and pick this provider.

# ⚠️ If you also use Codex with your real OpenAI account, this auth.json overwrites
# your OpenAI login. Use cc-switch (\`mimo2codex print-cc-switch\`) instead to switch
# between providers cleanly, or use \`mimo2codex print-config --env-key\` for the
# env-var-based variant (works for Codex CLI but not the desktop app).
`;
}

// Legacy env_key variant — keeps ~/.codex/auth.json untouched.
function configSnippetEnvKey(cfg: { host: string; port: number }, preset: ProviderPreset): string {
  const providerKey = preset === PRESETS.mimo ? "mimo" : preset.name.toLowerCase();
  return `# ~/.codex/config.toml — env-var variant (Codex CLI only; desktop app won't see shell env vars)
model = "${preset.defaultModel}"
model_provider = "${providerKey}"

[model_providers.${providerKey}]
name = "${preset.name} (via mimo2codex)"
base_url = "http://${cfg.host}:${cfg.port}/v1"
wire_api = "responses"
env_key = "MIMO2CODEX_KEY"
request_max_retries = 1

# Then in your shell (the same shell you launch \`codex\` from):
#   export MIMO2CODEX_KEY=anything           # macOS/Linux/Git Bash
#   $env:MIMO2CODEX_KEY="anything"           # Windows PowerShell
#   set MIMO2CODEX_KEY=anything              # Windows CMD (current session only)
#
# For Codex DESKTOP APP, this variant does NOT work — desktop apps launched from
# Finder/Start Menu don't inherit shell env vars. Use the default print-config
# (auth.json variant) or \`mimo2codex print-cc-switch\` instead.
`;
}

// cc-switch snippet
function ccSwitchSnippet(cfg: { host: string; port: number }, preset: ProviderPreset): string {
  const authJson = JSON.stringify({ OPENAI_API_KEY: "mimo2codex-local" }, null, 2);
  const providerKey = preset === PRESETS.mimo ? "mimo2codex" : preset.name.toLowerCase();
  const configToml = `model_provider = "${providerKey}"
model = "${preset.defaultModel}"

[model_providers.${providerKey}]
name = "${preset.name} (via mimo2codex)"
base_url = "http://${cfg.host}:${cfg.port}/v1"
wire_api = "responses"
requires_openai_auth = true
request_max_retries = 1
`;
  return `# cc-switch — Add Provider → Codex tab → Custom

# ───────── auth.json (paste into the auth.json textarea) ─────────
${authJson}

# ───────── config.toml (paste into the config.toml textarea) ─────────
${configToml}
# Note: OPENAI_API_KEY can be any non-empty string — mimo2codex does not
# validate inbound credentials. Your real ${preset.name} key stays in
# ${preset.apiKeyEnv} on the machine running mimo2codex.
`;
}

function printStartupBanner(cfg: Config): void {
  // eslint-disable-next-line no-console
  console.log(`mimo2codex v${VERSION} listening on http://${cfg.host}:${cfg.port}`);
  // eslint-disable-next-line no-console
  console.log(`provider:    ${cfg.providerPreset.name}`);
  // eslint-disable-next-line no-console
  console.log(`upstream:    ${cfg.baseUrl}`);
  // eslint-disable-next-line no-console
  console.log(`model:       ${cfg.model}`);
  // eslint-disable-next-line no-console
  console.log(`api key:     ${redactKey(cfg.apiKey)}`);
  // eslint-disable-next-line no-console
  console.log(`reasoning:   ${cfg.exposeReasoning ? "passthrough" : "hidden"}`);
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(configSnippet({ host: cfg.host, port: cfg.port }, cfg.providerPreset));
}

function main(): void {
  let parsed;
  try {
    parsed = parseArgv(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }

  if (parsed.showHelp) {
    // eslint-disable-next-line no-console
    console.log(HELP);
    return;
  }
  if (parsed.showVersion) {
    // eslint-disable-next-line no-console
    console.log(VERSION);
    return;
  }

  const providerName = parsed.provider ?? process.env.MIMO2CODEX_PROVIDER ?? "mimo";
  let preset: ProviderPreset;
  try {
    preset = resolvePreset(providerName);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }

  if (parsed.positional[0] === "print-config") {
    const host = parsed.host ?? "127.0.0.1";
    const port = parsed.port ?? 8788;
    const useEnvKey = parsed.envKey === true;
    // eslint-disable-next-line no-console
    console.log(useEnvKey ? configSnippetEnvKey({ host, port }, preset) : configSnippet({ host, port }, preset));
    return;
  }

  if (parsed.positional[0] === "print-cc-switch") {
    const host = parsed.host ?? "127.0.0.1";
    const port = parsed.port ?? 8788;
    // eslint-disable-next-line no-console
    console.log(ccSwitchSnippet({ host, port }, preset));
    return;
  }

  let cfg: Config;
  try {
    cfg = buildConfig(parsed, process.env, VERSION);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error: ${(err as Error).message}`);
    process.exit(2);
  }

  setVerbose(cfg.verbose);
  printStartupBanner(cfg);

  const server = startServer(cfg);
  server.on("listening", () => {
    log.debug("server listening");
  });
  server.on("error", (err) => {
    log.error("server error", { error: err.message });
    process.exit(1);
  });

  const shutdown = (sig: string) => {
    log.info(`received ${sig}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
