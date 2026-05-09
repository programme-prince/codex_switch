import { describe, expect, it } from "vitest";
import { respToResponses } from "../src/translate/respToResponses.js";
import type { ChatResponse, ResponsesRequest } from "../src/translate/types.js";

const baseReq: ResponsesRequest = { model: "mimo-v2.5-pro", input: "hi" };

function makeChat(opts: {
  content?: string | null;
  reasoning?: string | null;
  toolCalls?: Array<{ id: string; name: string; args: string }>;
  finish?: ChatResponse["choices"][number]["finish_reason"];
}): ChatResponse {
  return {
    id: "chatcmpl_x",
    object: "chat.completion",
    created: 1700000000,
    model: "mimo-v2.5-pro",
    choices: [
      {
        index: 0,
        finish_reason: opts.finish ?? "stop",
        message: {
          role: "assistant",
          content: opts.content ?? null,
          reasoning_content: opts.reasoning ?? null,
          tool_calls: opts.toolCalls
            ? opts.toolCalls.map((t) => ({
                id: t.id,
                type: "function" as const,
                function: { name: t.name, arguments: t.args },
              }))
            : undefined,
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

describe("respToResponses", () => {
  it("plain text response", () => {
    const r = respToResponses(makeChat({ content: "hello world" }), baseReq, {
      exposeReasoning: true,
    });
    expect(r.status).toBe("completed");
    expect(r.output).toHaveLength(1);
    expect(r.output[0].type).toBe("message");
    const msg = r.output[0] as { content: Array<{ type: string; text: string }> };
    expect(msg.content[0]).toEqual({
      type: "output_text",
      text: "hello world",
      annotations: [],
    });
    expect(r.usage).toEqual({ input_tokens: 10, output_tokens: 20, total_tokens: 30 });
  });

  it("reasoning + text emits reasoning item before message", () => {
    const r = respToResponses(
      makeChat({ content: "answer", reasoning: "let me think" }),
      baseReq,
      { exposeReasoning: true }
    );
    expect(r.output).toHaveLength(2);
    expect(r.output[0].type).toBe("reasoning");
    expect(r.output[1].type).toBe("message");
    const reason = r.output[0] as { summary: Array<{ text: string }> };
    expect(reason.summary[0].text).toBe("let me think");
  });

  it("with --no-reasoning, reasoning is hidden", () => {
    const r = respToResponses(
      makeChat({ content: "answer", reasoning: "internal" }),
      baseReq,
      { exposeReasoning: false }
    );
    expect(r.output.find((o) => o.type === "reasoning")).toBeUndefined();
  });

  it("tool_calls become function_call items", () => {
    const r = respToResponses(
      makeChat({
        content: null,
        toolCalls: [{ id: "call_1", name: "shell", args: '{"cmd":"ls"}' }],
        finish: "tool_calls",
      }),
      baseReq,
      { exposeReasoning: true }
    );
    expect(r.output).toHaveLength(1);
    const fc = r.output[0] as {
      type: string;
      call_id: string;
      name: string;
      arguments: string;
    };
    expect(fc.type).toBe("function_call");
    expect(fc.call_id).toBe("call_1");
    expect(fc.name).toBe("shell");
    expect(fc.arguments).toBe('{"cmd":"ls"}');
  });

  it("finish_reason=length sets incomplete_details", () => {
    const r = respToResponses(
      makeChat({ content: "truncated", finish: "length" }),
      baseReq,
      { exposeReasoning: true }
    );
    expect(r.status).toBe("incomplete");
    expect(r.incomplete_details).toEqual({ reason: "max_output_tokens" });
  });

  it("ids have proper prefixes", () => {
    const r = respToResponses(
      makeChat({ content: "x", reasoning: "y", toolCalls: [{ id: "c", name: "n", args: "{}" }] }),
      baseReq,
      { exposeReasoning: true }
    );
    expect(r.id).toMatch(/^resp_/);
    expect(r.output[0].id).toMatch(/^rs_/);
    expect(r.output[1].id).toMatch(/^msg_/);
    expect(r.output[2].id).toMatch(/^fc_/);
  });

  it("forwards web_search annotations (url_citation) onto the output_text content part", () => {
    const chat: ChatResponse = {
      id: "x",
      object: "chat.completion",
      created: 0,
      model: "mimo-v2.5-pro",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "上海明天多云。",
            annotations: [
              {
                type: "url_citation",
                url: "https://example.com/wx",
                title: "Shanghai weather",
                summary: "tomorrow cloudy",
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const r = respToResponses(chat, baseReq, { exposeReasoning: false });
    const msg = r.output[0] as { content: Array<{ annotations: Array<{ type: string; url: string; title: string; snippet?: string }> }> };
    expect(msg.content[0].annotations).toHaveLength(1);
    expect(msg.content[0].annotations[0].type).toBe("url_citation");
    expect(msg.content[0].annotations[0].url).toBe("https://example.com/wx");
    expect(msg.content[0].annotations[0].title).toBe("Shanghai weather");
    expect(msg.content[0].annotations[0].snippet).toBe("tomorrow cloudy");
  });
});
