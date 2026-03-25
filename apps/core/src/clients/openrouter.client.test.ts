import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openrouterConversationClient } from "@/clients/openrouter.client";

const fetchMock = vi.fn();

function createSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, { status: 200 });
}

function extractEventTypes(payload: string): string[] {
  return payload
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .map((data) => {
      if (data === "[DONE]") {
        return "[DONE]";
      }

      const parsed = JSON.parse(data) as { type?: string };
      return parsed.type ?? "unknown";
    });
}

describe("openrouter.client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the selected model id before calling OpenRouter", async () => {
    fetchMock.mockResolvedValueOnce(
      createSseResponse([
        `data: ${JSON.stringify({
          type: "response.output_text.delta",
          delta: "Hello",
        })}\n\n`,
        `data: ${JSON.stringify({ type: "response.completed" })}\n\n`,
      ]),
    );

    const response = await openrouterConversationClient.stream({
      actor: { userId: "user_1", organizationId: "org_1" },
      messages: [{ role: "user", content: "Hi there" }],
      modelId: "gpt-4o",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as {
      model: string;
      input: Array<{ role: string }>;
    };

    expect(body.model).toBe("openai/gpt-4o");
    expect(body.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hi there" }],
      },
    ]);
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
  });

  it("falls back to the default model when an unknown model id is provided", async () => {
    fetchMock.mockResolvedValueOnce(
      createSseResponse([
        `data: ${JSON.stringify({ type: "response.completed" })}\n\n`,
      ]),
    );

    await openrouterConversationClient.stream({
      actor: { userId: "user_2", organizationId: null },
      messages: [{ role: "user", content: "Default model please" }],
      modelId: "non-existent-model",
    });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as { model: string };

    expect(body.model).toBe("openai/gpt-5.2");
  });

  it("parses OpenRouter SSE chunks into UI message stream events", async () => {
    fetchMock.mockResolvedValueOnce(
      createSseResponse([
        'data: {"type":"response.output_text.delta","delta":"Hello',
        ' "}\n\n',
        "data: not-json\n\n",
        'data: {"type":"response.output_text.delta","delta":" world"}\n\n',
        'data: {"type":"response.completed"}\n\n',
      ]),
    );

    const response = await openrouterConversationClient.stream({
      actor: { userId: "user_3", organizationId: null },
      messages: [{ role: "user", content: "Test stream parsing" }],
      modelId: null,
    });

    const streamPayload = await response.text();
    const eventTypes = extractEventTypes(streamPayload);

    expect(eventTypes).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-delta",
      "text-end",
      "finish",
      "[DONE]",
    ]);
    expect(streamPayload).toContain('"delta":"Hello "');
    expect(streamPayload).toContain('"delta":" world"');
  });
});
