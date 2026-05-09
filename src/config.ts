export interface ModelInfo {
  id: string;
  owned_by: string;
  context_window?: number;
}

export interface ProviderPreset {
  name: string;
  defaultBaseUrl: string;
  apiKeyEnv: string;
  models: ModelInfo[];
  supportsWebSearch: boolean;
  defaultModel: string;
}

export const PRESETS: Record<string, ProviderPreset> = {
  mimo: {
    name: "MiMo",
    defaultBaseUrl: "https://api.xiaomimimo.com/v1",
    apiKeyEnv: "MIMO_API_KEY",
    models: [
      { id: "mimo-v2.5-pro", owned_by: "xiaomi", context_window: 128000 },
      { id: "mimo-v2.5-pro[1m]", owned_by: "xiaomi", context_window: 1048576 },
      { id: "mimo-v2.5", owned_by: "xiaomi", context_window: 128000 },
      { id: "mimo-v2.5[1m]", owned_by: "xiaomi", context_window: 1048576 },
    ],
    supportsWebSearch: true,
    defaultModel: "mimo-v2.5-pro",
  },
  deepseek: {
    name: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: [
      { id: "deepseek-chat", owned_by: "deepseek", context_window: 128000 },
      { id: "deepseek-reasoner", owned_by: "deepseek", context_window: 128000 },
      { id: "deepseek-v4-flash", owned_by: "deepseek", context_window: 128000 },
      { id: "deepseek-v4-flash[1m]", owned_by: "deepseek", context_window: 1048576 },
      { id: "deepseek-v4-pro", owned_by: "deepseek", context_window: 128000 },
      { id: "deepseek-v4-pro[1m]", owned_by: "deepseek", context_window: 1048576 },
    ],
    supportsWebSearch: false,
    defaultModel: "deepseek-v4-flash",
  },
};

export const PROVIDER_NAMES = Object.keys(PRESETS);

export interface Config {
  host: string;
  port: number;
  baseUrl: string;
  apiKey: string;
  provider: string;
  providerPreset: ProviderPreset;
  model: string;
  modelOverride?: string;
  exposeReasoning: boolean;
  noWebSearch: boolean;
  verbose: boolean;
  userAgent: string;
}

const DEFAULTS = {
  host: "127.0.0.1",
  port: 8788,
};

export interface ParsedArgs {
  host?: string;
  port?: number;
  baseUrl?: string;
  apiKey?: string;
  provider?: string;
  model?: string;
  exposeReasoning?: boolean;
  noWebSearch?: boolean;
  verbose?: boolean;
  envKey?: boolean;
  positional: string[];
  showHelp: boolean;
  showVersion: boolean;
}

export function parseArgv(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], showHelp: false, showVersion: false };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`flag ${a} requires a value`);
      i++;
      return v;
    };
    switch (a) {
      case "--port":
      case "-p":
        out.port = Number(next());
        if (Number.isNaN(out.port)) throw new Error("--port must be a number");
        break;
      case "--host":
        out.host = next();
        break;
      case "--base-url":
      case "--baseurl":
        out.baseUrl = next();
        break;
      case "--api-key":
        out.apiKey = next();
        break;
      case "--provider":
        out.provider = next();
        break;
      case "--model":
        out.model = next();
        break;
      case "--no-reasoning":
        out.exposeReasoning = false;
        break;
      case "--reasoning":
        out.exposeReasoning = true;
        break;
      case "--verbose":
      case "-v":
        out.verbose = true;
        break;
      case "--no-web-search":
        out.noWebSearch = true;
        break;
      case "--env-key":
        out.envKey = true;
        break;
      case "--help":
      case "-h":
        out.showHelp = true;
        break;
      case "--version":
      case "-V":
        out.showVersion = true;
        break;
      default:
        if (a.startsWith("--")) {
          throw new Error(`unknown flag: ${a}`);
        }
        out.positional.push(a);
    }
  }
  return out;
}

export function buildConfig(parsed: ParsedArgs, env: NodeJS.ProcessEnv, version: string): Config {
  const providerName = parsed.provider ?? env.MIMO2CODEX_PROVIDER ?? "mimo";
  const preset = PRESETS[providerName];
  if (!preset) {
    throw new Error(
      `unknown provider "${providerName}" — available: ${PROVIDER_NAMES.join(", ")}`
    );
  }

  const exposeReasoningEnv = env.MIMO2CODEX_NO_REASONING ? false : true;
  const verboseEnv = !!env.MIMO2CODEX_VERBOSE;
  const noWebSearchEnv = !!env.MIMO2CODEX_NO_WEB_SEARCH;

  const apiKey = parsed.apiKey ?? env[preset.apiKeyEnv] ?? "";
  if (!apiKey) {
    throw new Error(
      `missing ${preset.name} API key — set ${preset.apiKeyEnv} env var or pass --api-key.`
    );
  }

  const portFromEnv = env.MIMO2CODEX_PORT ? Number(env.MIMO2CODEX_PORT) : undefined;
  if (portFromEnv !== undefined && Number.isNaN(portFromEnv)) {
    throw new Error("MIMO2CODEX_PORT must be a number");
  }

  const model = parsed.model ?? preset.defaultModel;

  return {
    host: parsed.host ?? env.MIMO2CODEX_HOST ?? DEFAULTS.host,
    port: parsed.port ?? portFromEnv ?? DEFAULTS.port,
    baseUrl: parsed.baseUrl ?? preset.defaultBaseUrl,
    apiKey,
    provider: providerName,
    providerPreset: preset,
    model,
    modelOverride: parsed.model,
    exposeReasoning: parsed.exposeReasoning ?? exposeReasoningEnv,
    noWebSearch: parsed.noWebSearch ?? noWebSearchEnv,
    verbose: parsed.verbose ?? verboseEnv,
    userAgent: `mimo2codex/${version}`,
  };
}
