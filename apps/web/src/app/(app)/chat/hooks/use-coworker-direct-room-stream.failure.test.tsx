import type { ChatRoom } from "@sokosumi/core-client";
import { act, renderHook } from "@testing-library/react";
import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCoworkerDirectRoomStream } from "./use-coworker-direct-room-stream";

type ChatOptions = {
  onError: (error: Error) => void;
  onFinish: (event: { isError: boolean }) => Promise<void>;
};

const chat = vi.hoisted(() => ({
  options: null as ChatOptions | null,
  setMessages: null as ((messages: UIMessage[]) => void) | null,
  setStatus: null as ((status: string) => void) | null,
  sendMessage: vi.fn(),
  regenerate: vi.fn(),
  resumeStream: vi.fn(async () => {}),
  toastError: vi.fn(),
}));

vi.mock("@ai-sdk/react", async () => {
  const { useState } = await import("react");
  return {
    useChat: (options: ChatOptions) => {
      const [messages, setMessages] = useState<UIMessage[]>([]);
      const [status, setStatus] = useState("ready");
      chat.options = options;
      chat.setMessages = setMessages;
      chat.setStatus = setStatus;
      return {
        messages,
        setMessages,
        status,
        sendMessage: chat.sendMessage,
        regenerate: chat.regenerate,
        resumeStream: chat.resumeStream,
      };
    },
  };
});
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: chat.toastError } }));
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
  act(() => {
    chat.setMessages?.([
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Plan the launch" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Sure, fir" }],
      },
    ]);
    chat.setStatus?.("error");
    chat.options?.onError(
      new Error(JSON.stringify({ error: "Forbidden", message: BILLING })),
    );
  });
  await act(() => chat.options?.onFinish({ isError: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useCoworkerDirectRoomStream failed turn", () => {
  it("keeps the message as a failed row with the reason after the toast", async () => {
    const hook = renderStream();
    await sendAndFail(hook);

    expect(chat.toastError).toHaveBeenCalledWith(BILLING);
    // Refreshes Core's copy but keeps the failed row (no partial reply).
    expect(hook.onStreamSettled).toHaveBeenCalledWith("room-1");
    expect(hook.result.current.streamOverlayMessages).toEqual([
      expect.objectContaining({
        id: "pending:u1",
        content: "Plan the launch",
        metadata: {
          client_message_id: "u1",
          outbound_delivery_status: "failed",
          outbound_error: BILLING,
        },
      }),
    ]);
  });

  it("retries once with the same body, and the mark clears", async () => {
    const hook = renderStream();
    await sendAndFail(hook);

    act(() => {
      hook.result.current.retryFailedStreamMessage();
      hook.result.current.retryFailedStreamMessage();
    });
    act(() => chat.setStatus?.("submitted"));

    expect(chat.regenerate).toHaveBeenCalledTimes(1);
    expect(chat.regenerate).toHaveBeenCalledWith({
      body: { quote: { messageId: "quoted-1" } },
    });
    expect(hook.result.current.streamOverlayMessages[0]?.id).toBe("stream:u1");
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

    expect(chat.regenerate).not.toHaveBeenCalled();
    expect(chat.sendMessage).toHaveBeenLastCalledWith(
      { text: "Something else" },
      undefined,
    );
  });

  it("falls back to a no-reply reason when the error has no text", async () => {
    const hook = renderStream();
    act(() => {
      hook.result.current.sendStreamMessage("Hi");
      chat.setMessages?.([
        { id: "u2", role: "user", parts: [{ type: "text", text: "Hi" }] },
      ]);
      chat.setStatus?.("error");
      chat.options?.onError(new Error(""));
    });

    expect(chat.toastError).toHaveBeenCalledWith("Outbound.noReply");
    expect(
      hook.result.current.streamOverlayMessages[0]?.metadata,
    ).toMatchObject({ outbound_error: "Outbound.noReply" });
  });
});
