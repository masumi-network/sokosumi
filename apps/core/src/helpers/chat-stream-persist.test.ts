import { beforeEach, describe, expect, it, vi } from "vitest";

import { streamWithAssistantPersistence } from "./chat-stream-persist";

const {
  conversationFindFirstMock,
  conversationItemCreateMock,
  conversationItemFindFirstMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  conversationItemCreateMock: vi.fn(),
  conversationItemFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    conversation: {
      findFirst: conversationFindFirstMock,
    },
    conversationItem: {
      create: conversationItemCreateMock,
      findFirst: conversationItemFindFirstMock,
    },
  },
}));

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function createSseStream(events: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(event));
      }
      controller.close();
    },
  });
}

async function drainText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

describe("streamWithAssistantPersistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationItemCreateMock.mockResolvedValue(undefined);
    conversationItemFindFirstMock.mockResolvedValue(null);
  });

  it("persists accumulated assistant text from text-delta SSE events", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv_123",
    });
    const upstream = createSseStream([
      'data: {"type":"text-delta","delta":"Hello"}\n',
      'data: {"type":"text-delta","delta":" world"}\n',
      "\n",
    ]);

    const wrapped = streamWithAssistantPersistence(
      upstream,
      "conv_123",
      "user_123",
    );
    await drainText(wrapped);

    expect(conversationItemCreateMock).toHaveBeenCalledWith({
      data: {
        conversationId: "conv_123",
        role: "assistant",
        contentType: "output_text",
        contentText: "Hello world",
      },
    });
  });

  it("uses pending response id from conversation metadata when ref is empty", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv_123",
      metadata: {
        pending_responses_api_response_id: "resp_123",
      },
    });
    const upstream = createSseStream([
      'data: {"type":"text-delta","delta":"Recovered"}\n\n',
    ]);

    const wrapped = streamWithAssistantPersistence(
      upstream,
      "conv_123",
      "user_123",
      {
        responsesApiResponseIdRef: { current: null },
      },
    );
    await drainText(wrapped);

    expect(conversationItemFindFirstMock).toHaveBeenCalledWith({
      where: {
        conversationId: "conv_123",
        responsesApiResponseId: "resp_123",
      },
      select: { id: true },
    });
    expect(conversationItemCreateMock).toHaveBeenCalledWith({
      data: {
        conversationId: "conv_123",
        role: "assistant",
        contentType: "output_text",
        contentText: "Recovered",
        responsesApiResponseId: "resp_123",
      },
    });
  });

  it("does not persist duplicate response ids", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: "conv_123",
      metadata: {},
    });
    conversationItemFindFirstMock.mockResolvedValueOnce({ id: "item_123" });
    const upstream = createSseStream([
      'data: {"type":"text-delta","delta":"Already there"}\n\n',
    ]);

    const wrapped = streamWithAssistantPersistence(
      upstream,
      "conv_123",
      "user_123",
      {
        responsesApiResponseIdRef: { current: "resp_123" },
      },
    );
    await drainText(wrapped);

    expect(conversationItemCreateMock).not.toHaveBeenCalled();
  });
});
