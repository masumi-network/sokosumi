import { describe, expect, it } from "vitest";

import { deltaContentFrom, parseHermesStatus, readSseStream } from "./sse";

/** Builds a ReadableStream from string parts (each part flushed as one chunk),
 * so we can exercise the buffering across arbitrary chunk boundaries. */
function streamFrom(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

async function collect(parts: string[]) {
  const out: { event: string | null; data: string }[] = [];
  for await (const ev of readSseStream(streamFrom(parts))) out.push(ev);
  return out;
}

describe("readSseStream", () => {
  it("branches chat chunks vs named hermes.status frames", async () => {
    const events = await collect([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      "event: hermes.status\n" +
        'data: {"phase":"tool","label":"Searching the web"}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    expect(events).toHaveLength(4);
    expect(events[0]).toEqual({
      event: null,
      data: '{"choices":[{"delta":{"content":"Hel"}}]}',
    });
    expect(events[1]!.event).toBe("hermes.status");
    expect(events[3]).toEqual({ event: null, data: "[DONE]" });
  });

  it("reassembles frames split across chunk boundaries", async () => {
    const events = await collect([
      'data: {"choices":[{"de',
      'lta":{"content":"hi"}}]}\n',
      "\n",
    ]);
    expect(events).toHaveLength(1);
    expect(deltaContentFrom(events[0]!.data)).toBe("hi");
  });

  it("flushes trailing UTF-8 bytes held in the decoder", async () => {
    const emoji = "🙂";
    const encoder = new TextEncoder();
    const bytes = encoder.encode(
      `data: {"choices":[{"delta":{"content":"${emoji}"}}]}\n\n`,
    );
    const splitAt = bytes.length - 1;
    const events = await collect([
      new TextDecoder().decode(bytes.slice(0, splitAt)),
      new TextDecoder().decode(bytes.slice(splitAt)),
    ]);
    expect(events).toHaveLength(1);
    expect(deltaContentFrom(events[0]!.data)).toBe(emoji);
  });

  it("handles CRLF line endings", async () => {
    const events = await collect([
      "event: hermes.status\r\n" +
        'data: {"phase":"working","label":"Working"}\r\n\r\n',
    ]);
    expect(events[0]!.event).toBe("hermes.status");
  });
});

describe("deltaContentFrom", () => {
  it("extracts incremental content", () => {
    expect(deltaContentFrom('{"choices":[{"delta":{"content":"abc"}}]}')).toBe(
      "abc",
    );
  });

  it("returns null for [DONE], empty, status frames, and junk", () => {
    expect(deltaContentFrom("[DONE]")).toBeNull();
    expect(deltaContentFrom("")).toBeNull();
    expect(deltaContentFrom('{"phase":"tool","label":"x"}')).toBeNull();
    expect(deltaContentFrom("not json")).toBeNull();
    expect(deltaContentFrom('{"choices":[{"delta":{}}]}')).toBeNull();
  });
});

describe("parseHermesStatus", () => {
  it("parses a tool frame with id + label + detail", () => {
    expect(
      parseHermesStatus(
        '{"phase":"tool","id":"call_1","label":"Asking Hannah","detail":"market size"}',
      ),
    ).toEqual({
      phase: "tool",
      id: "call_1",
      label: "Asking Hannah",
      detail: "market size",
    });
  });

  it("parses a tool_done frame (label not required)", () => {
    expect(
      parseHermesStatus('{"phase":"tool_done","id":"call_1","detail":"{...}"}'),
    ).toEqual({ phase: "tool_done", id: "call_1", detail: "{...}" });
  });

  it("returns null without a phase or for invalid JSON", () => {
    expect(parseHermesStatus('{"label":"x"}')).toBeNull();
    expect(parseHermesStatus("nope")).toBeNull();
  });
});
