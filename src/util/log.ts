type Level = "debug" | "info" | "warn" | "error";

let verbose = false;

export function setVerbose(v: boolean): void {
  verbose = v;
}

function emit(level: Level, msg: string, extra?: unknown): void {
  if (level === "debug" && !verbose) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] ${level.toUpperCase()}`;
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console.error(prefix, msg, extra);
  } else {
    // eslint-disable-next-line no-console
    console.error(prefix, msg);
  }
}

export const log = {
  debug: (msg: string, extra?: unknown) => emit("debug", msg, extra),
  info: (msg: string, extra?: unknown) => emit("info", msg, extra),
  warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra),
};

export function redactKey(k: string | undefined | null): string {
  if (!k) return "<empty>";
  if (k.length <= 8) return "***";
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}
