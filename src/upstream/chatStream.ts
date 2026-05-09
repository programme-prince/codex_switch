import { createParser, type EventSourceMessage } from "eventsource-parser";
import type { ChatStreamChunk } from "../translate/types.js";
import { log } from "../util/log.js";

// Convert a fetch Response with text/event-stream body into an AsyncIterable
// of parsed ChatStreamChunk objects. Skips [DONE] and malformed chunks.
export async function* iterChatStreamChunks(
  response: Response
): AsyncGenerator<ChatStreamChunk, void, void> {
  if (!response.body) {
    throw new Error("upstream returned empty body for streaming response");
  }
  const queue: ChatStreamChunk[] = [];
  let done = false;

  const parser = createParser({
    onEvent(event: EventSourceMessage) {
      const data = event.data;
      if (!data || data === "[DONE]") return;
      try {
        const obj = JSON.parse(data) as ChatStreamChunk;
        queue.push(obj);
      } catch (err) {
        log.warn("failed to parse upstream SSE chunk; skipping", {
          error: (err as Error).message,
          data: data.slice(0, 200),
        });
      }
    },
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  try {
    while (true) {
      // Drain anything the parser already produced.
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) return;

      const { value, done: rDone } = await reader.read();
      if (rDone) {
        done = true;
        continue;
      }
      const text = decoder.decode(value, { stream: true });
      parser.feed(text);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}
