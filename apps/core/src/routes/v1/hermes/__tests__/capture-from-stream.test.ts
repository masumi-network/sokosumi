import { describe, expect, it } from "vitest";

import { captureFromStream } from "../index";

/** Builds a ReadableStream from string parts (each flushed as one chunk) so we
 * can exercise buffering across chunk boundaries. */
function streamFrom(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

describe("captureFromStream", () => {
  it("captures content + reasoning + tool steps, ignoring tool_done raw detail", async () => {
    const result = await captureFromStream(
      streamFrom([
        'event: hermes.status\ndata: {"phase":"thinking"}\n\n',
        'event: hermes.status\ndata: {"phase":"reasoning","detail":"The user wants a web search."}\n\n',
        'event: hermes.status\ndata: {"phase":"tool","id":"c1","label":"Searching the web","detail":"moe llms 2026"}\n\n',
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        // tool_done carries a raw truncated result — must NOT become a step.
        'event: hermes.status\ndata: {"phase":"tool_done","id":"c1","detail":"{\\"raw\\":true}"}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'event: hermes.status\ndata: {"phase":"answering"}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    expect(result.content).toBe("Hello");
    expect(result.steps).toEqual([
      { kind: "reasoning", label: "The user wants a web search." },
      { kind: "tool", label: "Searching the web", detail: "moe llms 2026" },
    ]);
  });

  it("reassembles content split across chunk boundaries", async () => {
    const result = await captureFromStream(
      streamFrom([
        'data: {"choices":[{"de',
        'lta":{"content":"hi"}}]}\n',
        "\n",
        "data: [DONE]\n\n",
      ]),
    );
    expect(result.content).toBe("hi");
  });

  it("returns empty for a stream with no tools or content", async () => {
    const result = await captureFromStream(
      streamFrom([
        'event: hermes.status\ndata: {"phase":"thinking"}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    expect(result.content).toBe("");
    expect(result.steps).toEqual([]);
  });
});
