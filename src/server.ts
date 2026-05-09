import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import { reqToChat } from "./translate/reqToChat.js";
import { respToResponses } from "./translate/respToResponses.js";
import { pipeChatStreamToResponses } from "./translate/streamToSse.js";
import { iterChatStreamChunks } from "./upstream/chatStream.js";
import { callMimo, UpstreamError } from "./upstream/mimoClient.js";
import { makeServerResponseSink } from "./util/sse.js";
import { log } from "./util/log.js";
import type { ChatResponse, ResponsesRequest } from "./translate/types.js";

const KEEPALIVE_INTERVAL_MS = 15_000;

async function readJsonBody<T>(req: IncomingMessage, maxBytes = 16 * 1024 * 1024): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        if (!text) return resolve({} as T);
        resolve(JSON.parse(text) as T);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function errorEnvelope(status: number, code: string, message: string): {
  error: { type: string; code: string; message: string; status: number };
} {
  return {
    error: {
      type:
        status === 401
          ? "authentication_error"
          : status === 429
            ? "rate_limit_exceeded"
            : status >= 500
              ? "server_error"
              : "invalid_request_error",
      code,
      message,
      status,
    },
  };
}

async function handleResponses(
  cfg: Config,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let payload: ResponsesRequest;
  try {
    payload = await readJsonBody<ResponsesRequest>(req);
  } catch (err) {
    return sendJson(
      res,
      400,
      errorEnvelope(400, "invalid_json", `failed to parse request body: ${(err as Error).message}`)
    );
  }
  if (!payload.model) {
    return sendJson(
      res,
      400,
      errorEnvelope(400, "missing_model", "request body must include 'model'")
    );
  }

  // Override model if --model flag was explicitly set
  if (cfg.modelOverride) {
    payload.model = cfg.modelOverride;
  }

  // Strip context-window suffix like [1m] — the upstream API uses the base
  // model name only. The suffix is a client-side hint for context size.
  payload.model = payload.model.replace(/\[[^\]]*\]$/, "");

  const chat = reqToChat(payload, {
    noWebSearch: cfg.noWebSearch,
    supportsWebSearch: cfg.providerPreset.supportsWebSearch,
  });
  const stream = !!payload.stream;
  chat.stream = stream;

  const ac = new AbortController();
  req.on("close", () => ac.abort());

  if (!stream) {
    try {
      const upstreamRes = await callMimo(
        { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, userAgent: cfg.userAgent, providerName: cfg.providerPreset.name },
        chat,
        ac.signal
      );
      const chatJson = (await upstreamRes.json()) as ChatResponse;
      const responses = respToResponses(chatJson, payload, {
        exposeReasoning: cfg.exposeReasoning,
      });
      return sendJson(res, 200, responses);
    } catch (err) {
      if (err instanceof UpstreamError) {
        return sendJson(res, err.status, errorEnvelope(err.status, err.code, err.message));
      }
      log.error("non-stream request failed", { error: (err as Error).message });
      return sendJson(res, 500, errorEnvelope(500, "internal_error", (err as Error).message));
    }
  }

  // Streaming path. Strategy: don't open the SSE stream to the client until we
  // know the upstream is OK. This way upstream errors map to clean HTTP errors
  // instead of half-opened SSE streams that confuse the Codex client.
  let upstreamRes: Response;
  try {
    upstreamRes = await callMimo(
      { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, userAgent: cfg.userAgent, providerName: cfg.providerPreset.name },
      chat,
      ac.signal
    );
  } catch (err) {
    if (err instanceof UpstreamError) {
      return sendJson(res, err.status, errorEnvelope(err.status, err.code, err.message));
    }
    log.error("stream request failed (pre-stream)", { error: (err as Error).message });
    return sendJson(res, 500, errorEnvelope(500, "internal_error", (err as Error).message));
  }

  // Upstream returned 200 — now we can safely open the SSE stream.
  const sink = makeServerResponseSink(res);
  const keepalive = setInterval(() => sink.comment("keepalive"), KEEPALIVE_INTERVAL_MS);
  res.on("close", () => clearInterval(keepalive));

  try {
    const chunks = iterChatStreamChunks(upstreamRes);
    await pipeChatStreamToResponses(
      sink,
      { chunks },
      payload,
      { exposeReasoning: cfg.exposeReasoning }
    );
  } catch (err) {
    log.error("stream request failed (mid-stream)", { error: (err as Error).message });
    // pipeChatStreamToResponses handles its own errors with response.failed,
    // so reaching here means something unexpected in our own code.
    if (!sink.closed()) {
      sink.write("error", {
        type: "error",
        code: "server_error",
        message: (err as Error).message,
        sequence_number: 9999,
      });
      sink.end();
    }
  } finally {
    clearInterval(keepalive);
  }
}

function handleModels(cfg: Config, res: ServerResponse): void {
  sendJson(res, 200, {
    object: "list",
    data: cfg.providerPreset.models.map((m) => ({
      id: m.id,
      object: "model",
      owned_by: m.owned_by,
      ...(m.context_window ? { context_window: m.context_window } : {}),
    })),
  });
}

export function startServer(cfg: Config): Server {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";

    if (req.method === "GET" && (url === "/healthz" || url === "/")) {
      sendJson(res, 200, { ok: true, name: "mimo2codex", baseUrl: cfg.baseUrl });
      return;
    }
    if (req.method === "GET" && url.startsWith("/v1/models")) {
      handleModels(cfg, res);
      return;
    }
    if (req.method === "POST" && url.startsWith("/v1/responses")) {
      void handleResponses(cfg, req, res);
      return;
    }
    sendJson(res, 404, errorEnvelope(404, "not_found", `no route for ${req.method} ${url}`));
  });

  server.listen(cfg.port, cfg.host);
  return server;
}
