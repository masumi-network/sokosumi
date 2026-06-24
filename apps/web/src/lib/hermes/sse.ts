/**
 * Minimal Server-Sent-Events reader that branches on the SSE `event:` field.
 *
 * Hermes streams OpenAI-compatible chat chunks (no `event:`, i.e. the default
 * "message" event) interleaved with named `event: hermes.status` progress
 * frames. A spec-correct parser MUST route them separately: status frames omit
 * `choices`, so feeding them to the chat-chunk handler is wrong. This reader
 * surfaces the event name so the caller can branch.
 */
export interface SseEvent {
  /** The SSE `event:` name, or null when the frame had none (default message). */
  event: string | null;
  /** Concatenated `data:` payload (newline-joined, no trailing newline). */
  data: string;
}

export interface HermesStatusEvent {
  phase:
    | "thinking"
    | "reasoning"
    | "tool"
    | "tool_done"
    | "working"
    | "answering";
  /** tool_call_id — links a `tool` frame to its later `tool_done`. */
  id?: string;
  /** Present for `tool` frames; optional on others. */
  label?: string;
  detail?: string;
  elapsedMs?: number;
  ts?: number;
}

function parseFrame(raw: string): SseEvent | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) continue; // blank / comment
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).replace(/^ /, ""));
    }
  }
  if (event === null && dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

/** Yields SSE frames from a fetch response body, framed on the blank-line delimiter. */
export async function* readSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const frame = parseFrame(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
        if (frame) yield frame;
        sep = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() !== "") {
      const tail = parseFrame(buffer);
      if (tail) yield tail;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Extracts the incremental assistant text from an OpenAI-compatible chat chunk.
 * Returns null for `[DONE]`, keepalives, or any frame without delta content
 * (defensive: a status frame routed here by mistake yields null, never throws).
 */
export function deltaContentFrom(data: string): string | null {
  if (data === "" || data === "[DONE]") return null;
  try {
    const json = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string | null } }>;
    };
    const content = json.choices?.[0]?.delta?.content;
    return typeof content === "string" && content.length > 0 ? content : null;
  } catch {
    return null;
  }
}

/** Parses a `hermes.status` payload defensively. */
export function parseHermesStatus(data: string): HermesStatusEvent | null {
  try {
    const json = JSON.parse(data) as Partial<HermesStatusEvent>;
    if (typeof json.phase !== "string") return null;
    return json as HermesStatusEvent;
  } catch {
    return null;
  }
}
