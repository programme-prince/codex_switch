import type {
  ChatAnnotation,
  ChatStreamChunk,
  ResponsesObject,
  ResponsesOutputItem,
  ResponsesRequest,
  ResponsesUsage,
} from "./types.js";
import {
  newFunctionCallId,
  newMessageId,
  newReasoningId,
  newResponseId,
} from "../util/ids.js";
import type { SseSink } from "../util/sse.js";

export interface StreamToSseOpts {
  exposeReasoning: boolean;
}

interface ToolCallState {
  itemId: string;
  outputIndex: number;
  callId: string;
  name: string;
  argsBuffer: string;
  argsEmitted: boolean;
}

type ActiveKind = "reasoning" | "message" | null;

interface ResponsesAnnotation {
  type: string;
  url: string;
  title: string;
  snippet?: string;
}

class StreamState {
  responseId = newResponseId();
  createdAt = Math.floor(Date.now() / 1000);
  model: string;
  outputIndex = 0;
  sequenceNumber = 0;
  activeKind: ActiveKind = null;
  activeItemId: string | null = null;
  activeBuffer = "";
  activeAnnotations: ResponsesAnnotation[] = [];
  toolCalls = new Map<number, ToolCallState>();
  finalOutput: ResponsesOutputItem[] = [];
  finishReason: ChatStreamChunk["choices"][number]["finish_reason"] | null = null;
  usage: ResponsesUsage | null = null;
  exposeReasoning: boolean;
  req: ResponsesRequest;

  constructor(req: ResponsesRequest, exposeReasoning: boolean) {
    this.req = req;
    this.model = req.model;
    this.exposeReasoning = exposeReasoning;
  }

  nextSeq(): number {
    return this.sequenceNumber++;
  }
}

// Each Responses SSE event MUST include `type` in the JSON payload (in addition
// to the SSE `event:` line) — the Codex client parses events from the data field,
// not the SSE event header. Missing `type` leads to "stream disconnected before
// completion" errors because the client never recognizes response.completed.
function emit(sink: SseSink, state: StreamState, event: string, data: Record<string, unknown>): void {
  sink.write(event, { type: event, ...data, sequence_number: state.nextSeq() });
}

function buildResponseSnapshot(state: StreamState, status: ResponsesObject["status"]): ResponsesObject {
  return {
    id: state.responseId,
    object: "response",
    created_at: state.createdAt,
    status,
    model: state.model,
    output: state.finalOutput,
    usage: state.usage,
    parallel_tool_calls: state.req.parallel_tool_calls ?? true,
    tool_choice: state.req.tool_choice ?? "auto",
    reasoning: {
      effort: state.req.reasoning?.effort ?? null,
      summary: state.req.reasoning?.summary ?? null,
    },
    text: state.req.text?.format
      ? { format: state.req.text.format }
      : { format: { type: "text" } },
    incomplete_details:
      state.finishReason === "length" ? { reason: "max_output_tokens" } : null,
    error: null,
    metadata: state.req.metadata ?? null,
    previous_response_id: state.req.previous_response_id ?? null,
    instructions: state.req.instructions ?? null,
    temperature: state.req.temperature ?? null,
    top_p: state.req.top_p ?? null,
    max_output_tokens: state.req.max_output_tokens ?? null,
    tools: state.req.tools ?? [],
    truncation: "disabled",
  };
}

function openReasoning(sink: SseSink, state: StreamState): void {
  finalizeActive(sink, state);
  state.activeKind = "reasoning";
  state.activeItemId = newReasoningId();
  state.activeBuffer = "";
  const idx = state.outputIndex++;
  emit(sink, state, "response.output_item.added", {
    output_index: idx,
    item: {
      id: state.activeItemId,
      type: "reasoning",
      summary: [],
      encrypted_content: null,
      status: "in_progress",
    },
  });
  emit(sink, state, "response.reasoning_summary_part.added", {
    item_id: state.activeItemId,
    output_index: idx,
    summary_index: 0,
    part: { type: "summary_text", text: "" },
  });
}

function openMessage(sink: SseSink, state: StreamState): void {
  finalizeActive(sink, state);
  state.activeKind = "message";
  state.activeItemId = newMessageId();
  state.activeBuffer = "";
  state.activeAnnotations = [];
  const idx = state.outputIndex++;
  emit(sink, state, "response.output_item.added", {
    output_index: idx,
    item: {
      id: state.activeItemId,
      type: "message",
      role: "assistant",
      status: "in_progress",
      content: [],
    },
  });
  emit(sink, state, "response.content_part.added", {
    item_id: state.activeItemId,
    output_index: idx,
    content_index: 0,
    part: { type: "output_text", text: "", annotations: [] },
  });
}

function translateAnnotation(a: ChatAnnotation): ResponsesAnnotation {
  return {
    type: a.type ?? "url_citation",
    url: a.url ?? "",
    title: a.title ?? "",
    ...(a.summary !== undefined ? { snippet: a.summary } : {}),
  };
}

function openToolCall(
  sink: SseSink,
  state: StreamState,
  index: number,
  id: string | undefined,
  name: string | undefined
): ToolCallState {
  finalizeActive(sink, state);
  const itemId = newFunctionCallId();
  const outputIndex = state.outputIndex++;
  const callId = id ?? `call_${itemId.slice(3)}`;
  const tc: ToolCallState = {
    itemId,
    outputIndex,
    callId,
    name: name ?? "",
    argsBuffer: "",
    argsEmitted: false,
  };
  state.toolCalls.set(index, tc);
  emit(sink, state, "response.output_item.added", {
    output_index: outputIndex,
    item: {
      id: itemId,
      type: "function_call",
      call_id: callId,
      name: tc.name,
      arguments: "",
      status: "in_progress",
    },
  });
  return tc;
}

function finalizeActive(sink: SseSink, state: StreamState): void {
  if (state.activeKind === null) return;

  const itemId = state.activeItemId!;
  const buffer = state.activeBuffer;
  const outputIndex = state.outputIndex - 1;

  if (state.activeKind === "reasoning") {
    emit(sink, state, "response.reasoning_summary_text.done", {
      item_id: itemId,
      output_index: outputIndex,
      summary_index: 0,
      text: buffer,
    });
    emit(sink, state, "response.reasoning_summary_part.done", {
      item_id: itemId,
      output_index: outputIndex,
      summary_index: 0,
      part: { type: "summary_text", text: buffer },
    });
    const finalItem: ResponsesOutputItem = {
      id: itemId,
      type: "reasoning",
      summary: [{ type: "summary_text", text: buffer }],
      encrypted_content: null,
      status: "completed",
    };
    state.finalOutput.push(finalItem);
    emit(sink, state, "response.output_item.done", {
      output_index: outputIndex,
      item: finalItem,
    });
  } else if (state.activeKind === "message") {
    const annotations = state.activeAnnotations;
    emit(sink, state, "response.output_text.done", {
      item_id: itemId,
      output_index: outputIndex,
      content_index: 0,
      text: buffer,
    });
    emit(sink, state, "response.content_part.done", {
      item_id: itemId,
      output_index: outputIndex,
      content_index: 0,
      part: { type: "output_text", text: buffer, annotations },
    });
    const finalItem: ResponsesOutputItem = {
      id: itemId,
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: buffer, annotations }],
    };
    state.finalOutput.push(finalItem);
    emit(sink, state, "response.output_item.done", {
      output_index: outputIndex,
      item: finalItem,
    });
  }

  state.activeKind = null;
  state.activeItemId = null;
  state.activeBuffer = "";
  state.activeAnnotations = [];
}

function finalizeToolCalls(sink: SseSink, state: StreamState): void {
  // Emit done events for tool calls in the order they were opened.
  const ordered = Array.from(state.toolCalls.entries()).sort((a, b) => a[0] - b[0]);
  for (const [, tc] of ordered) {
    emit(sink, state, "response.function_call_arguments.done", {
      item_id: tc.itemId,
      output_index: tc.outputIndex,
      arguments: tc.argsBuffer,
    });
    const finalItem: ResponsesOutputItem = {
      id: tc.itemId,
      type: "function_call",
      call_id: tc.callId,
      name: tc.name,
      arguments: tc.argsBuffer,
      status: "completed",
    };
    state.finalOutput.push(finalItem);
    emit(sink, state, "response.output_item.done", {
      output_index: tc.outputIndex,
      item: finalItem,
    });
  }
}

function processChunk(sink: SseSink, state: StreamState, chunk: ChatStreamChunk): void {
  if (chunk.usage) {
    state.usage = {
      input_tokens: chunk.usage.prompt_tokens,
      output_tokens: chunk.usage.completion_tokens,
      total_tokens: chunk.usage.total_tokens,
    };
    if (chunk.usage.prompt_tokens_details?.cached_tokens !== undefined) {
      state.usage.input_tokens_details = {
        cached_tokens: chunk.usage.prompt_tokens_details.cached_tokens,
      };
    }
    if (chunk.usage.completion_tokens_details?.reasoning_tokens !== undefined) {
      state.usage.output_tokens_details = {
        reasoning_tokens: chunk.usage.completion_tokens_details.reasoning_tokens,
      };
    }
  }

  const choice = chunk.choices?.[0];
  if (!choice) return;
  const delta = choice.delta;

  if (delta.reasoning_content && state.exposeReasoning) {
    if (state.activeKind !== "reasoning") openReasoning(sink, state);
    state.activeBuffer += delta.reasoning_content;
    emit(sink, state, "response.reasoning_summary_text.delta", {
      item_id: state.activeItemId!,
      output_index: state.outputIndex - 1,
      summary_index: 0,
      delta: delta.reasoning_content,
    });
  }

  if (delta.content) {
    if (state.activeKind !== "message") openMessage(sink, state);
    state.activeBuffer += delta.content;
    emit(sink, state, "response.output_text.delta", {
      item_id: state.activeItemId!,
      output_index: state.outputIndex - 1,
      content_index: 0,
      delta: delta.content,
    });
  }

  // MiMo's web_search returns citations in the first streaming chunk's
  // `delta.annotations`. Buffer them and emit per-annotation events so Codex
  // can show inline citations live.
  if (delta.annotations && delta.annotations.length > 0) {
    if (state.activeKind !== "message") openMessage(sink, state);
    for (const a of delta.annotations) {
      const translated = translateAnnotation(a);
      const annotationIndex = state.activeAnnotations.length;
      state.activeAnnotations.push(translated);
      emit(sink, state, "response.output_text.annotation.added", {
        item_id: state.activeItemId!,
        output_index: state.outputIndex - 1,
        content_index: 0,
        annotation_index: annotationIndex,
        annotation: translated,
      });
    }
  }

  if (delta.tool_calls) {
    for (const tcDelta of delta.tool_calls) {
      let tc = state.toolCalls.get(tcDelta.index);
      if (!tc) {
        tc = openToolCall(sink, state, tcDelta.index, tcDelta.id, tcDelta.function?.name);
      } else if (tcDelta.function?.name && !tc.name) {
        tc.name = tcDelta.function.name;
      }
      if (tcDelta.function?.arguments) {
        tc.argsBuffer += tcDelta.function.arguments;
        tc.argsEmitted = true;
        emit(sink, state, "response.function_call_arguments.delta", {
          item_id: tc.itemId,
          output_index: tc.outputIndex,
          delta: tcDelta.function.arguments,
        });
      }
    }
  }

  if (choice.finish_reason) {
    state.finishReason = choice.finish_reason;
  }
}

export interface StreamPipelineSource {
  chunks: AsyncIterable<ChatStreamChunk>;
}

export async function pipeChatStreamToResponses(
  sink: SseSink,
  source: StreamPipelineSource,
  req: ResponsesRequest,
  opts: StreamToSseOpts
): Promise<void> {
  const state = new StreamState(req, opts.exposeReasoning);

  emit(sink, state, "response.created", {
    response: buildResponseSnapshot(state, "in_progress"),
  });
  emit(sink, state, "response.in_progress", {
    response: buildResponseSnapshot(state, "in_progress"),
  });

  try {
    for await (const chunk of source.chunks) {
      if (sink.closed()) return;
      processChunk(sink, state, chunk);
    }
  } catch (err) {
    finalizeActive(sink, state);
    finalizeToolCalls(sink, state);
    const message = err instanceof Error ? err.message : String(err);
    const failedSnapshot = buildResponseSnapshot(state, "failed");
    failedSnapshot.error = { type: "upstream_error", message };
    emit(sink, state, "response.failed", { response: failedSnapshot });
    sink.end();
    return;
  }

  finalizeActive(sink, state);
  finalizeToolCalls(sink, state);

  const completed = buildResponseSnapshot(state, "completed");
  emit(sink, state, "response.completed", { response: completed });
  sink.end();
}
