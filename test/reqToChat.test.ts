import { describe, expect, it } from "vitest";
import { reqToChat } from "../src/translate/reqToChat.js";
import type { ResponsesRequest } from "../src/translate/types.js";

describe("reqToChat", () => {
  it("instructions-only request becomes a single system message", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      instructions: "You are MiMo.",
      input: [],
    };
    const chat = reqToChat(req);
    expect(chat).toEqual({
      model: "mimo-v2.5-pro",
      messages: [{ role: "system", content: "You are MiMo." }],
      stream: false,
    });
  });

  it("simple user text", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      instructions: "be helpful",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    const chat = reqToChat(req);
    expect(chat.messages).toEqual([
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi" },
    ]);
  });

  it("string input is treated as user content", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "hello",
    };
    const chat = reqToChat(req);
    expect(chat.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("developer role becomes system", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "x" }] },
      ],
    };
    const chat = reqToChat(req);
    expect(chat.messages[0]).toEqual({ role: "system", content: "x" });
  });

  it("tool definitions wrap into function objects", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [{ type: "message", role: "user", content: "go" }],
      tools: [
        {
          type: "function",
          name: "shell",
          description: "run shell",
          parameters: { type: "object", properties: { cmd: { type: "string" } } },
          strict: true,
        },
      ],
      tool_choice: "auto",
    };
    const chat = reqToChat(req);
    expect(chat.tools).toEqual([
      {
        type: "function",
        function: {
          name: "shell",
          description: "run shell",
          parameters: { type: "object", properties: { cmd: { type: "string" } } },
          strict: true,
        },
      },
    ]);
    expect(chat.tool_choice).toBe("auto");
  });

  it("tool_choice with named function", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [{ type: "message", role: "user", content: "go" }],
      tool_choice: { type: "function", function: { name: "shell" } },
    };
    const chat = reqToChat(req);
    expect(chat.tool_choice).toEqual({ type: "function", function: { name: "shell" } });
  });

  it("function_call from history with output (round trip after tool exec)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "list files" }] },
        {
          type: "function_call",
          call_id: "call_abc",
          name: "shell",
          arguments: '{"cmd":"ls"}',
        },
        { type: "function_call_output", call_id: "call_abc", output: "a.txt\nb.txt" },
        { type: "message", role: "user", content: "thanks, count them" },
      ],
    };
    const chat = reqToChat(req);
    expect(chat.messages).toEqual([
      { role: "user", content: "list files" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_abc",
            type: "function",
            function: { name: "shell", arguments: '{"cmd":"ls"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_abc", content: "a.txt\nb.txt" },
      { role: "user", content: "thanks, count them" },
    ]);
  });

  it("reasoning + function_call collapse into single assistant turn with reasoning_content", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        { type: "message", role: "user", content: "search for cats" },
        {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "I should call the search tool." }],
        },
        {
          type: "function_call",
          call_id: "call_1",
          name: "search",
          arguments: '{"q":"cats"}',
        },
        { type: "function_call_output", call_id: "call_1", output: "5 results" },
      ],
    };
    const chat = reqToChat(req);
    expect(chat.messages).toEqual([
      { role: "user", content: "search for cats" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "search", arguments: '{"q":"cats"}' },
          },
        ],
        reasoning_content: "I should call the search tool.",
      },
      { role: "tool", tool_call_id: "call_1", content: "5 results" },
    ]);
  });

  it("user message with text + image parts (omni model — images preserved)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2-omni",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "what's this?" },
            { type: "input_image", image_url: "https://x/y.png", detail: "auto" },
          ],
        },
      ],
    };
    const chat = reqToChat(req);
    expect(chat.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what's this?" },
        { type: "image_url", image_url: { url: "https://x/y.png", detail: "auto" } },
      ],
    });
  });

  it("drops image parts on non-omni model and adds an inline placeholder note", () => {
    // mimo-v2.5-pro and friends return 404 "No endpoints found that support image
    // input" if image_url parts are forwarded. We strip them with a short note so
    // the model still has context that an image was attached.
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "what's this?" },
            { type: "input_image", image_url: "https://x/y.png" },
            { type: "input_image", image_url: "https://x/z.png" },
          ],
        },
      ],
    };
    const chat = reqToChat(req);
    // Should be a single user message with text only (collapsed to string when
    // all parts are text after dropping images)
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].role).toBe("user");
    const content = chat.messages[0].content;
    expect(typeof content).toBe("string");
    expect(content).toContain("what's this?");
    expect(content).toContain("2 image attachments omitted");
    expect(content).toContain("mimo-v2-omni");
    // Definitely no image_url part
    expect(JSON.stringify(chat.messages[0])).not.toContain("image_url");
  });

  it("preserves images on the 1m context omni variant", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2-omni[1m]",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_image", image_url: "https://x/y.png" }],
        },
      ],
    };
    const chat = reqToChat(req);
    expect(JSON.stringify(chat.messages[0])).toContain("image_url");
  });

  it("preserves images on plain `mimo-v2.5` (image-understanding model per docs)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "describe" },
            { type: "input_image", image_url: "https://x/y.png" },
          ],
        },
      ],
    };
    const chat = reqToChat(req);
    expect(JSON.stringify(chat.messages[0])).toContain("image_url");
  });

  it("DROPS images on mimo-v2.5-pro (per official docs: only mimo-v2.5 and -omni support vision)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "what's this?" },
            { type: "input_image", image_url: "https://x/y.png" },
          ],
        },
      ],
    };
    const chat = reqToChat(req);
    expect(JSON.stringify(chat.messages[0])).not.toContain("image_url");
    expect(chat.messages[0].content).toContain("what's this?");
    expect(chat.messages[0].content).toContain("image attachment");
  });

  it("ensures a text part exists when image_url is present (avoid MiMo 400 'text is not set')", () => {
    // Image-only user message — Codex CLI / desktop allow paste+enter without typing.
    // MiMo's image API requires at least one text part in the content array.
    const req: ResponsesRequest = {
      model: "mimo-v2.5",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_image", image_url: "https://x/y.png" }],
        },
      ],
    };
    const chat = reqToChat(req);
    const content = chat.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<{ type: string }>;
    // Must have BOTH image_url and text parts
    expect(parts.some((p) => p.type === "image_url")).toBe(true);
    expect(parts.some((p) => p.type === "text")).toBe(true);
  });

  it("does NOT add a fallback text part when image is absent (text-only stays clean)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      ],
    };
    const chat = reqToChat(req);
    // text-only collapses to string, no extra spaces or padding parts
    expect(chat.messages[0].content).toBe("hello");
  });

  it("filters input_text parts whose `text` is empty/missing — MiMo rejects them", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "" },
            { type: "input_text" } as unknown as { type: "input_text"; text: string },
            { type: "input_text", text: "real content" },
            { type: "input_image", image_url: "https://x/y.png" },
          ],
        },
      ],
    };
    const chat = reqToChat(req);
    const content = chat.messages[0].content as Array<{ type: string; text?: string }>;
    const textParts = content.filter((p) => p.type === "text");
    expect(textParts).toHaveLength(1);
    expect(textParts[0].text).toBe("real content");
  });

  it("on pro model with image-only message, output is non-empty text-only string (the original 400 case)", () => {
    // The exact scenario that produced "MiMo returned 400: text is not set":
    // model = mimo-v2.5-pro (no vision) + content has only an image.
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_image", image_url: "https://x/y.png" }],
        },
      ],
    };
    const chat = reqToChat(req);
    const content = chat.messages[0].content;
    expect(typeof content).toBe("string");
    expect((content as string).length).toBeGreaterThan(0);
    expect(content).toContain("image attachment");
    expect(JSON.stringify(chat.messages[0])).not.toContain("image_url");
  });

  it("max_output_tokens maps to max_completion_tokens (not max_tokens)", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      max_output_tokens: 1024,
    };
    const chat = reqToChat(req);
    expect(chat.max_completion_tokens).toBe(1024);
    expect((chat as Record<string, unknown>).max_tokens).toBeUndefined();
  });

  it("preserves stream flag", () => {
    const req: ResponsesRequest = { model: "mimo-v2.5-pro", input: "x", stream: true };
    expect(reqToChat(req).stream).toBe(true);
  });

  it("drops only the builtin tools that have no MiMo equivalent (code_interpreter etc.)", () => {
    // web_search_preview is now TRANSLATED to MiMo's web_search builtin, so it
    // should remain. code_interpreter has no MiMo equivalent → dropped.
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        { type: "web_search_preview" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "code_interpreter" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "function", name: "shell", parameters: { type: "object" } },
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toHaveLength(2);
    const types = chat.tools!.map((t) => t.type).sort();
    expect(types).toEqual(["function", "web_search"]);
  });

  it("translates local_shell builtin into a function tool named 'shell'", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "list files",
      tools: [{ type: "local_shell" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toHaveLength(1);
    const fn = chat.tools![0].function;
    expect(fn.name).toBe("shell");
    expect(fn.parameters).toBeDefined();
    expect((fn.parameters as { properties: Record<string, unknown> }).properties.command).toBeDefined();
  });

  it("drops function tool that has no name instead of forwarding name=undefined", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [{ type: "function" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toBeUndefined(); // empty after filter, field omitted entirely
  });

  it("when ALL tools get filtered (truly unsupported only), the tools field is omitted entirely", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        { type: "code_interpreter" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "image_generation" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toBeUndefined();
  });

  it("translates `custom` tool type into a function tool with permissive schema", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        {
          type: "custom",
          name: "my_grammar_tool",
          description: "Output a SQL query.",
          format: { type: "grammar", syntax: "lark", definition: "..." },
        } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toHaveLength(1);
    const fn = chat.tools![0].function;
    expect(fn.name).toBe("my_grammar_tool");
    expect(fn.description).toContain("SQL");
    expect(fn.description).toContain("grammar");
    expect((fn.parameters as { type: string }).type).toBe("object");
  });

  it("recurses into `namespace` wrapper and flattens nested function + builtin tools", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        {
          type: "namespace",
          name: "playwright",
          tools: [
            { type: "function", name: "browser_open", parameters: { type: "object" } },
            { type: "function", name: "browser_click", parameters: { type: "object" } },
            { type: "code_interpreter" }, // nested server-only — should drop
          ],
        } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "function", name: "shell", parameters: { type: "object" } },
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toHaveLength(3);
    const names = chat.tools!
      .filter((t): t is { type: "function"; function: { name: string } } => t.type === "function")
      .map((t) => t.function.name)
      .sort();
    expect(names).toEqual(["browser_click", "browser_open", "shell"]);
  });

  it("server-side-only tools (code_interpreter, computer_use, etc.) are silently dropped", () => {
    // These have no MiMo equivalent; they're silently dropped.
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        { type: "code_interpreter" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "computer_use_preview" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
        { type: "image_generation" } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toBeUndefined();
  });

  it("Codex web_search_preview is translated to MiMo's native web_search builtin", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "今天上海天气?",
      tools: [
        {
          type: "web_search_preview",
          user_location: { type: "approximate", country: "China", city: "Shanghai" },
          search_context_size: "medium",
        } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toHaveLength(1);
    const tool = chat.tools![0] as { type: string; user_location?: { city?: string } };
    expect(tool.type).toBe("web_search");
    expect(tool.user_location?.city).toBe("Shanghai");
    // Codex's search_context_size has no MiMo equivalent → omitted
    expect((tool as Record<string, unknown>).search_context_size).toBeUndefined();
    // No `function` wrapper — it's a builtin tool, not a function tool
    expect((tool as Record<string, unknown>).function).toBeUndefined();
  });

  it("plain Codex web_search (no user_location) is translated and preserves MiMo extras", () => {
    const req: ResponsesRequest = {
      model: "mimo-v2.5-pro",
      input: "x",
      tools: [
        {
          type: "web_search",
          max_keyword: 5,
          force_search: true,
          limit: 3,
        } as unknown as ResponsesRequest["tools"] extends Array<infer T> ? T : never,
      ] as ResponsesRequest["tools"],
    };
    const chat = reqToChat(req);
    expect(chat.tools).toHaveLength(1);
    const tool = chat.tools![0] as Record<string, unknown>;
    expect(tool.type).toBe("web_search");
    expect(tool.max_keyword).toBe(5);
    expect(tool.force_search).toBe(true);
    expect(tool.limit).toBe(3);
    expect(tool.user_location).toBeUndefined();
  });
});
