import type { ChatRoom } from "@sokosumi/core-client";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCoworkerDirectRoomStream } from "./use-coworker-direct-room-stream";

type SendOptions = Parameters<ChatTransport<UIMessage>["sendMessages"]>[0];
type SendHandler = (
  options: SendOptions,
) => Promise<ReadableStream<UIMessageChunk>>;

interface OpenStream {
  close: () => void;
}

const transportState = vi.hoisted(() => ({
  sendQueue: [] as SendHandler[],
  sendCalls: [] as Array<{
    trigger: SendOptions["trigger"];
    body: unknown;
    messages: UIMessage[];
  }>,
  openStreams: [] as OpenStream[],
  toastError: vi.fn(),
}));

function createPendingStream(): ReadableStream<UIMessageChunk> {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>;
  let closed = false;
  const stream = new ReadableStream<UIMessageChunk>({
    start(nextController) {
      controller = nextController;
    },
    cancel() {
      closed = true;
    },
  });
  transportState.openStreams.push({
    close() {
      if (!closed) {
        closed = true;
        controller.close();
      }
    },
  });
  return stream;
}

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();

  class FakeDefaultChatTransport implements ChatTransport<UIMessage> {
    readonly resumeStreamIsReplay = true;

    sendMessages: ChatTransport<UIMessage>["sendMessages"] = async (
      options,
    ) => {
      transportState.sendCalls.push({
        trigger: options.trigger,
        body: options.body,
        messages: options.messages,
      });
      const handler = transportState.sendQueue.shift();
      if (handler) {
        return handler(options);
      }
      return createPendingStream();
    };

    reconnectToStream: ChatTransport<UIMessage>["reconnectToStream"] =
      async () => null;
  }

  return {
    ...actual,
    DefaultChatTransport: FakeDefaultChatTransport,
  };
});

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: transportState.toastError } }));
vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: { messageStart: vi.fn() },
}));

const room = {
  id: "room-1",
  userMembers: [{ id: "user-1", name: "Ada", image: null }],
  coworkerMembers: [{ id: "cow-1", name: "Jamal", slug: "jamal" }],
} as unknown as ChatRoom;

const BILLING =
  "This AI coworker cannot accept messages right now because its provider account needs billing setup.";

function renderStream() {
  const onStreamSettled = vi.fn(async () => true);
  const hook = renderHook(() =>
    useCoworkerDirectRoomStream({
      room,
      enabled: true,
      currentUserId: "user-1",
      organizationSlug: null,
      onStreamSettled,
    }),
  );
  return { ...hook, onStreamSettled };
}

/** Send with a file and a quote, then fail after a partial reply. */
async function sendAndFail(hook: ReturnType<typeof renderStream>) {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>;
  transportState.sendQueue.push(
    async () =>
      new ReadableStream<UIMessageChunk>({
        start(nextController) {
          controller = nextController;
          controller.enqueue({ type: "start", messageId: "a1" });
          controller.enqueue({ type: "text-start", id: "t1" });
          controller.enqueue({
            type: "text-delta",
            id: "t1",
            delta: "Sure, fir",
          });
        },
      }),
  );

  act(() => {
    hook.result.current.sendStreamMessage("Plan the launch", {
      quote: { messageId: "quoted-1" },
      files: [
        {
          url: "https://x/brief.png",
          fileName: "brief.png",
          mediaType: "image/png",
        },
      ],
    });
  });

  await waitFor(() => {
    expect(hook.result.current.streamOverlayMessages).toEqual([
      expect.objectContaining({ content: "Plan the launch" }),
      expect.objectContaining({ content: "Sure, fir" }),
    ]);
  });

  act(() => {
    controller.error(
      new Error(JSON.stringify({ error: "Forbidden", message: BILLING })),
    );
  });

  await waitFor(() => {
    expect(hook.onStreamSettled).toHaveBeenCalledWith("room-1");
    expect(hook.result.current.streamOverlayMessages).toHaveLength(1);
    expect(hook.result.current.streamOverlayMessages[0]?.id).toMatch(
      /^pending:/,
    );
  });
}

beforeEach(() => {
  transportState.sendQueue.length = 0;
  transportState.sendCalls.length = 0;
  transportState.openStreams.length = 0;
  transportState.toastError.mockClear();
  sessionStorage.clear();
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    for (const stream of transportState.openStreams) {
      stream.close();
    }
  });
});

describe("useCoworkerDirectRoomStream failed turn", () => {
  it("keeps the message as a failed row with the reason after the toast", async () => {
    const hook = renderStream();
    await sendAndFail(hook);

    const userMessageId = transportState.sendCalls[0]?.messages[0]?.id;
    expect(userMessageId).toBeTruthy();
    expect(transportState.toastError).toHaveBeenCalledWith(BILLING);
    // Refreshes Core's copy but keeps the failed row (no partial reply).
    expect(hook.onStreamSettled).toHaveBeenCalledWith("room-1");
    expect(hook.result.current.streamOverlayMessages).toEqual([
      expect.objectContaining({
        id: `pending:${userMessageId}`,
        content: "Plan the launch",
        metadata: {
          client_message_id: userMessageId,
          outbound_delivery_status: "failed",
          outbound_error: BILLING,
        },
      }),
    ]);
  });

  it("retries once with the same body, and the mark clears", async () => {
    const hook = renderStream();
    await sendAndFail(hook);

    const userMessageId = transportState.sendCalls[0]?.messages[0]?.id;

    act(() => {
      hook.result.current.retryFailedStreamMessage();
      hook.result.current.retryFailedStreamMessage();
    });

    await waitFor(() => expect(transportState.sendCalls).toHaveLength(2));
    expect(transportState.sendCalls[1]?.trigger).toBe("regenerate-message");
    expect(transportState.sendCalls[1]?.body).toEqual({
      quote: { messageId: "quoted-1" },
    });
    expect(hook.result.current.streamOverlayMessages[0]?.id).toBe(
      `stream:${userMessageId}`,
    );
  });

  it("drops the failure when the next message is sent", async () => {
    const hook = renderStream();
    await sendAndFail(hook);

    act(() => {
      hook.result.current.sendStreamMessage("Something else");
    });
    act(() => {
      hook.result.current.retryFailedStreamMessage();
    });

    await waitFor(() => expect(transportState.sendCalls).toHaveLength(2));
    expect(transportState.sendCalls[1]?.trigger).toBe("submit-message");
    expect(transportState.sendCalls[1]?.body).toBeUndefined();
    expect(transportState.sendCalls[1]?.messages[0]?.parts).toEqual([
      { type: "text", text: "Something else" },
    ]);
  });

  it("falls back to a no-reply reason when the error has no text", async () => {
    const hook = renderStream();
    transportState.sendQueue.push(async () => {
      throw new Error("");
    });

    act(() => {
      hook.result.current.sendStreamMessage("Hi");
    });

    await waitFor(() => {
      expect(transportState.toastError).toHaveBeenCalledWith(
        "Outbound.noReply",
      );
      expect(
        hook.result.current.streamOverlayMessages[0]?.metadata,
      ).toMatchObject({ outbound_error: "Outbound.noReply" });
    });
  });
});
