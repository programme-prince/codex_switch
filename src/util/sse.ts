import type { ServerResponse } from "node:http";

// Writes a single SSE event in the canonical "event: <name>\ndata: <json>\n\n" format.
// Works with both node:http ServerResponse and a plain async iterable consumer
// (we just need .write() and .flush() semantics).
export interface SseSink {
  write(event: string, data: unknown): void;
  comment(text: string): void;
  end(): void;
  closed(): boolean;
}

export function makeServerResponseSink(res: ServerResponse): SseSink {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof (res as unknown as { flushHeaders?: () => void }).flushHeaders === "function") {
    (res as unknown as { flushHeaders: () => void }).flushHeaders();
  }

  let isClosed = false;
  res.on("close", () => {
    isClosed = true;
  });

  return {
    write(event, data) {
      if (isClosed) return;
      const payload = typeof data === "string" ? data : JSON.stringify(data);
      res.write(`event: ${event}\ndata: ${payload}\n\n`);
    },
    comment(text) {
      if (isClosed) return;
      res.write(`: ${text}\n\n`);
    },
    end() {
      if (isClosed) return;
      isClosed = true;
      res.end();
    },
    closed() {
      return isClosed;
    },
  };
}

// In-memory sink used by tests so we can assert the exact event sequence.
export interface RecordedEvent {
  event: string;
  data: unknown;
}

export function makeMemorySink(): SseSink & { events: RecordedEvent[]; comments: string[] } {
  const events: RecordedEvent[] = [];
  const comments: string[] = [];
  let isClosed = false;
  return {
    events,
    comments,
    write(event, data) {
      if (isClosed) return;
      events.push({ event, data });
    },
    comment(text) {
      if (isClosed) return;
      comments.push(text);
    },
    end() {
      isClosed = true;
    },
    closed() {
      return isClosed;
    },
  };
}
