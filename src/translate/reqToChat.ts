import type {
  ChatContentPart,
  ChatMessage,
  ChatRequest,
  ChatTool,
  ChatWebSearchTool,
  ChatToolChoice,
  ChatToolCall,
  ResponsesContentPart,
  ResponsesInputItem,
  ResponsesMessageItem,
  ResponsesRequest,
  ResponsesTool,
  ResponsesToolChoice,
} from "./types.js";
import { log } from "../util/log.js";

// Per MiMo docs (https://platform.xiaomimimo.com/docs/zh-CN/usage-guide/multimodal-understanding/image-understanding),
// only `mimo-v2.5` and `mimo-v2-omni` (and *-omni* variants) accept image
// input. The other v2.5 variants (mimo-v2.5-pro, mimo-v2.5-pro[1m],
// mimo-v2-flash, …) return 404 "No endpoints found that support image input"
// when given image_url parts.
function modelSupportsImages(model: string): boolean {
  // Strip the optional context-window suffix like [1m]
  const base = model.replace(/\[[^\]]*\]$/, "").toLowerCase();
  if (base.includes("omni")) return true;
  if (base === "mimo-v2.5") return true;
  return false;
}

function partsToChatContent(
  parts: ResponsesContentPart[] | string,
  ctx: { model: string; supportsImages: boolean }
): string | ChatContentPart[] {
  if (typeof parts === "string") return parts;

  const out: ChatContentPart[] = [];
  let droppedImages = 0;
  for (const p of parts) {
    if (p.type === "input_text" || p.type === "output_text") {
      // Defensive: Codex/clients sometimes send malformed text parts where
      // `text` is missing or non-string. Coerce to "" and drop empties —
      // MiMo's parser rejects parts where `text` is missing/empty with
      // "Param Incorrect: `text` is not set".
      const text = typeof p.text === "string" ? p.text : "";
      if (text.length === 0) continue;
      out.push({ type: "text", text });
    } else if (p.type === "input_image") {
      if (ctx.supportsImages) {
        out.push({ type: "image_url", image_url: { url: p.image_url, detail: p.detail } });
      } else {
        droppedImages++;
      }
    } else if (p.type === "input_file") {
      // MiMo doesn't natively support file inputs in chat completions.
      // Drop the part but leave the message intact.
      log.warn("dropped input_file part — MiMo chat API does not accept file inputs");
    }
    // Unknown part types (e.g. summary_text in some Responses variants) are
    // silently skipped — they'd cause MiMo to 400 if forwarded as-is.
  }

  if (droppedImages > 0) {
    log.warn(
      `dropped ${droppedImages} image part(s) — model "${ctx.model}" does not support image input (use mimo-v2.5 or mimo-v2-omni for vision)`
    );
    // Add a short inline note so the model knows context was lost.
    out.push({
      type: "text",
      text: `[${droppedImages} image attachment${droppedImages > 1 ? "s" : ""} omitted: this model does not support image input. Switch to mimo-v2.5 or mimo-v2-omni for vision tasks.]`,
    });
  }

  // MiMo's image-understanding API REQUIRES at least one `text` part in the
  // content array whenever `image_url` parts are present. Otherwise it 400s
  // with "Param Incorrect: `text` is not set" (yes, even though OpenAI's
  // chat API doesn't require this). Codex sometimes sends image-only user
  // messages (paste-and-send), so we add an empty fallback to satisfy the
  // schema. The image alone is usually enough context for the model.
  const hasImage = out.some((p) => p.type === "image_url");
  const hasText = out.some((p) => p.type === "text");
  if (hasImage && !hasText) {
    out.push({ type: "text", text: " " });
  }

  // If the message is purely text, collapse to a string for cleaner upstream payloads.
  if (out.length > 0 && out.every((p) => p.type === "text")) {
    return out.map((p) => (p as { text: string }).text).join("");
  }
  if (out.length === 0) return "";
  return out;
}

function messageItemToChat(
  item: ResponsesMessageItem,
  ctx: { model: string; supportsImages: boolean }
): ChatMessage {
  const role = item.role === "developer" ? "system" : item.role;
  const content = partsToChatContent(item.content, ctx);
  if (role === "assistant") {
    return { role: "assistant", content: typeof content === "string" ? content : "" };
  }
  return { role, content };
}

// Schema for Codex's `local_shell` builtin tool, mapped to a regular function
// tool that MiMo (and any chat-completions-only provider) can understand.
// Codex registers handlers for both `local_shell` (builtin) and `shell`
// (function), so emitting `shell` tool_calls back to it just works.
const LOCAL_SHELL_FN: ChatTool = {
  type: "function",
  function: {
    name: "shell",
    description:
      "Execute a shell command on the local machine. Returns stdout, stderr and exit code.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "array",
          items: { type: "string" },
          description:
            "Argv array, e.g. [\"ls\", \"-la\"]. The first element is the program; remaining elements are arguments.",
        },
        workdir: {
          type: "string",
          description: "Working directory to run the command in (optional).",
        },
        timeout_ms: {
          type: "number",
          description: "Timeout in milliseconds (optional, default 30000).",
        },
      },
      required: ["command"],
    },
    strict: null,
  },
};

// Tools that exist server-side at OpenAI but have no equivalent at MiMo.
// We drop them silently (only log at debug level) — there's nothing a chat
// completions provider can do with them. NOTE: web_search and
// web_search_preview are NOT in this list — MiMo has its own native
// web_search builtin (requires the Web Search Plugin to be activated in
// the MiMo console: https://platform.xiaomimimo.com/#/console/plugin).
const SERVER_SIDE_TOOLS = new Set([
  "code_interpreter",
  "file_search",
  "image_generation",
  "computer_use_preview",
  "computer_use",
]);

// Track tool types we've already warned about so we don't spam the log on
// every request (Codex re-sends the full tool list each turn).
const warnedTypes = new Set<string>();
function warnOnce(toolType: string, msg: string): void {
  if (warnedTypes.has(toolType)) return;
  warnedTypes.add(toolType);
  log.warn(msg);
}

// Returns one or more ChatTools (a `namespace` wrapper can expand to many),
// or null if the tool is unrecognized / unsupported.
function toolToChat(t: ResponsesTool): ChatTool | ChatTool[] | null {
  // 1. Standard OpenAI function tool — pass through.
  if (t.type === "function") {
    const ft = t as { type: "function"; name?: string; description?: string; parameters?: Record<string, unknown>; strict?: boolean | null };
    if (!ft.name) {
      log.debug("dropping function tool with no name");
      return null;
    }
    return {
      type: "function",
      function: {
        name: ft.name,
        description: ft.description,
        parameters: ft.parameters,
        strict: ft.strict ?? null,
      },
    };
  }

  // 2. Codex's `local_shell` builtin → emit as a regular `shell` function tool
  //    with the canonical schema (see LOCAL_SHELL_FN above). Codex's tool router
  //    accepts both names.
  if (t.type === "local_shell") {
    return LOCAL_SHELL_FN;
  }

  // 2.5. OpenAI's `web_search` / `web_search_preview` → MiMo's native `web_search`.
  //      MiMo's format is similar (user_location + a few extras like max_keyword,
  //      force_search, limit). OpenAI's `search_context_size` has no MiMo
  //      equivalent — drop it. The MiMo Web Search Plugin must be activated
  //      in the user's console for this to actually work upstream.
  if (t.type === "web_search" || t.type === "web_search_preview") {
    const w = t as {
      user_location?: ChatWebSearchTool["user_location"];
      max_keyword?: number;
      force_search?: boolean;
      limit?: number;
    };
    const tool: ChatWebSearchTool = { type: "web_search" };
    if (w.user_location) tool.user_location = w.user_location;
    if (typeof w.max_keyword === "number") tool.max_keyword = w.max_keyword;
    if (typeof w.force_search === "boolean") tool.force_search = w.force_search;
    if (typeof w.limit === "number") tool.limit = w.limit;
    return tool;
  }

  // 3. Codex / OpenAI `custom` tool — freeform tool, often used for grammar-
  //    constrained outputs. We can't enforce the grammar at MiMo, but we can
  //    forward the name + description as a parameter-less function so the
  //    model can still call it. Format here:
  //      { type: "custom", name, description?, format?: { type: "grammar" | "text", ... } }
  if (t.type === "custom") {
    const ct = t as { name?: string; description?: string; format?: { type?: string } };
    if (!ct.name) {
      log.debug("dropping custom tool with no name");
      return null;
    }
    const formatType = ct.format?.type;
    const desc =
      (ct.description ?? "") +
      (formatType
        ? ` (originally a "${formatType}"-format custom tool; output should follow that format).`
        : "");
    return {
      type: "function",
      function: {
        name: ct.name,
        description: desc.trim() || undefined,
        // Permissive schema since we don't know the original input shape.
        parameters: {
          type: "object",
          properties: {
            input: {
              type: "string",
              description: "Input text for the tool.",
            },
          },
          additionalProperties: true,
        },
        strict: null,
      },
    };
  }

  // 4. `namespace` wrapper — Codex bundles MCP / grouped tools under this. Shape
  //    we've seen in the wild:
  //       { type: "namespace", name?: string, tools?: Tool[] }
  //    Recurse into nested tools and flatten. If there's no nested array, drop.
  if (t.type === "namespace") {
    const ns = t as { name?: string; tools?: ResponsesTool[] };
    if (!Array.isArray(ns.tools) || ns.tools.length === 0) {
      log.debug(
        `dropping "namespace" tool ${ns.name ? `"${ns.name}"` : ""} with no nested tools`
      );
      return null;
    }
    const nested: ChatTool[] = [];
    for (const inner of ns.tools) {
      const r = toolToChat(inner);
      if (Array.isArray(r)) nested.push(...r);
      else if (r) nested.push(r);
    }
    return nested.length > 0 ? nested : null;
  }

  // 5. Server-side tools that only OpenAI/Azure can fulfill — silently drop.
  if (SERVER_SIDE_TOOLS.has(t.type)) {
    log.debug(
      `dropping server-side tool "${t.type}" — no MiMo equivalent (only OpenAI/Azure can fulfill)`
    );
    return null;
  }

  // 6. Truly unknown — warn once per type so we get a heads-up but don't spam.
  warnOnce(
    t.type,
    `dropping unsupported tool type "${t.type}" — please open an issue if this should be translated`
  );
  return null;
}

function toolChoiceToChat(tc: ResponsesToolChoice | undefined): ChatToolChoice | undefined {
  if (tc === undefined) return undefined;
  if (typeof tc === "string") return tc;
  if (tc.type === "function") {
    const name = tc.function?.name ?? tc.name;
    if (!name) return undefined;
    return { type: "function", function: { name } };
  }
  return undefined;
}

interface AssemblyState {
  pendingReasoning: string | null;
  pendingToolCalls: ChatToolCall[];
  pendingAssistantText: string | null;
}

function flushAssistant(messages: ChatMessage[], state: AssemblyState): void {
  const hasReasoning = state.pendingReasoning !== null;
  const hasTools = state.pendingToolCalls.length > 0;
  const hasText = state.pendingAssistantText !== null;
  if (!hasReasoning && !hasTools && !hasText) return;

  const msg: ChatMessage = { role: "assistant", content: hasText ? state.pendingAssistantText : null };
  if (hasTools) msg.tool_calls = state.pendingToolCalls;
  if (hasReasoning) msg.reasoning_content = state.pendingReasoning;
  messages.push(msg);

  state.pendingReasoning = null;
  state.pendingToolCalls = [];
  state.pendingAssistantText = null;
}

function inputItemsToMessages(
  items: ResponsesInputItem[],
  ctx: { model: string; supportsImages: boolean }
): ChatMessage[] {
  const out: ChatMessage[] = [];
  const state: AssemblyState = {
    pendingReasoning: null,
    pendingToolCalls: [],
    pendingAssistantText: null,
  };

  for (const item of items) {
    switch (item.type) {
      case "message": {
        if (item.role === "assistant") {
          // Assistant message — fold into pending so reasoning_content can join it.
          const content = partsToChatContent(item.content, ctx);
          state.pendingAssistantText =
            typeof content === "string" ? content : "";
          // If assistant message comes alone (without preceding reasoning or
          // following tool_calls), flush immediately so we keep ordering.
          flushAssistant(out, state);
        } else {
          flushAssistant(out, state);
          out.push(messageItemToChat(item, ctx));
        }
        break;
      }
      case "reasoning": {
        flushAssistant(out, state);
        const text = item.summary
          .filter((s) => s.type === "summary_text")
          .map((s) => s.text)
          .join("");
        state.pendingReasoning = text;
        break;
      }
      case "function_call": {
        state.pendingToolCalls.push({
          id: item.call_id,
          type: "function",
          function: { name: item.name, arguments: item.arguments },
        });
        break;
      }
      case "function_call_output": {
        flushAssistant(out, state);
        out.push({
          role: "tool",
          tool_call_id: item.call_id,
          content: item.output,
        });
        break;
      }
    }
  }
  flushAssistant(out, state);
  return out;
}

export interface ReqToChatOptions {
  noWebSearch?: boolean;
  supportsWebSearch?: boolean;
}

export function reqToChat(req: ResponsesRequest, opts?: ReqToChatOptions): ChatRequest {
  const messages: ChatMessage[] = [];
  const ctx = {
    model: req.model,
    supportsImages: modelSupportsImages(req.model),
  };

  if (req.instructions) {
    messages.push({ role: "system", content: req.instructions });
  }

  if (typeof req.input === "string") {
    messages.push({ role: "user", content: req.input });
  } else if (Array.isArray(req.input)) {
    for (const m of inputItemsToMessages(req.input, ctx)) {
      messages.push(m);
    }
  }

  const chat: ChatRequest = {
    model: req.model,
    messages,
    stream: req.stream ?? false,
  };

  if (req.tools && req.tools.length > 0) {
    const mapped: ChatTool[] = [];
    const stripWebSearch = opts?.noWebSearch || opts?.supportsWebSearch === false;
    for (const t of req.tools) {
      if (stripWebSearch && (t.type === "web_search" || t.type === "web_search_preview")) {
        log.debug("dropping web_search tool" + (opts?.noWebSearch ? " (--no-web-search)" : " (provider does not support web search)"));
        continue;
      }
      const r = toolToChat(t);
      if (Array.isArray(r)) mapped.push(...r);
      else if (r) mapped.push(r);
    }
    if (mapped.length > 0) chat.tools = mapped;
  }
  const tc = toolChoiceToChat(req.tool_choice);
  if (tc !== undefined) chat.tool_choice = tc;

  if (req.parallel_tool_calls !== undefined) {
    chat.parallel_tool_calls = req.parallel_tool_calls;
  }
  if (req.temperature !== undefined && req.temperature !== null) {
    chat.temperature = req.temperature;
  }
  if (req.top_p !== undefined && req.top_p !== null) {
    chat.top_p = req.top_p;
  }
  if (req.max_output_tokens !== undefined && req.max_output_tokens !== null) {
    chat.max_completion_tokens = req.max_output_tokens;
  }

  return chat;
}
