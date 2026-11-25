import type { ChatRoom } from "@sokosumi/core-client";
import { act, render, renderHook } from "@testing-library/react";
import type { UIMessage } from "ai";
import { Activity } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RESUME_PENDING_STREAM_MESSAGE_ID,
  readStoredStreamParentMessageId,
  useCoworkerDirectRoomStream,
} from "./use-coworker-direct-room-stream";

type ChatOptions = {
  id?: string;
  onError?: (error: Error) => void;
  onFinish?: (event: { isError: boolean }) => Promise<void>;
};

interface MockChatHandle {
  setMessages: (messages: UIMessage[]) => void;
  setStatus: (status: string) => void;
  finish: (event?: { isError?: boolean }) => Promise<void>;
}

const chatMock = vi.hoisted(() => ({
  handles: [] as MockChatHandle[],
  sendMessage: vi.fn(),
  regenerate: vi.fn(),
  resumeStream: vi.fn(async () => {}),
  toastError: vi.fn(),
}));

vi.mock("@ai-sdk/react", async () => {
  const { useCallback, useRef, useState } = await import("react");
  return {
    useChat: (options: ChatOptions) => {
      const latestOptionsRef = useRef(options);
      latestOptionsRef.current = options;

      // Mirror @ai-sdk/react: each chat id owns its own messages and status.
      const [state, setState] = useState<{
        id: string | undefined;
        messages: UIMessage[];
        status: string;
      }>(() => ({ id: options.id, messages: [], status: "ready" }));

      if (state.id !== options.id) {
        setState({ id: options.id, messages: [], status: "ready" });
      }

      const setMessages = useCallback((next: UIMessage[]) => {
        setState((current) => ({ ...current, messages: next }));
      }, []);
      const setStatus = useCallback((next: string) => {
        setState((current) => ({ ...current, status: next }));
      }, []);

      const handleRef = useRef<MockChatHandle | null>(null);
      if (!handleRef.current) {
        handleRef.current = {
          setMessages,
          setStatus,
          finish: async (event = {}) => {
            await latestOptionsRef.current.onFinish?.({
              isError: event.isError ?? false,
            });
          },
        };
        chatMock.handles.push(handleRef.current);
      }

      return {
        messages: state.id === options.id ? state.messages : [],
        setMessages,
        status: state.id === options.id ? state.status : "ready",
        sendMessage: chatMock.sendMessage,
        regenerate: chatMock.regenerate,
        resumeStream: chatMock.resumeStream,
      };
    },
  };
});
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: chatMock.toastError } }));
vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: { messageStart: vi.fn() },
}));

const makeRoom = (id: string) =>
  ({
    id,
    userMembers: [{ id: "user-1", name: "Ada", image: null }],
    coworkerMembers: [{ id: "cow-1", name: "Jamal", slug: "jamal" }],
  }) as unknown as ChatRoom;

const roomA = makeRoom("room-a");
const roomB = makeRoom("room-b");
const textMsg = (
  id: string,
  role: "user" | "assistant",
  text: string,
): UIMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
});

function mountStream(
  onStreamSettled: (roomId: string) => Promise<boolean> = async () => true,
  initialRoom: ChatRoom = roomA,
) {
  const hook = renderHook(
    ({ room }: { room: ChatRoom }) =>
      useCoworkerDirectRoomStream({
        room,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled,
      }),
    { initialProps: { room: initialRoom } },
  );
  return { hook, handle: chatMock.handles.at(-1)! };
}

beforeEach(() => {
  vi.clearAllMocks();
  chatMock.handles.length = 0;
  sessionStorage.clear();
});

describe("useCoworkerDirectRoomStream stale finish settlement", () => {
  it("keeps a newer thread turn's stored parent and routes mid-stream re-entry after in-place A -> B -> A", async () => {
    const visit1Refresh = Promise.withResolvers<boolean>();
    const onStreamSettled = vi.fn(() => visit1Refresh.promise);
    const { hook, handle } = mountStream(onStreamSettled);

    act(() => {
      hook.result.current.sendStreamMessage("First", {
        parentMessageId: "parent-1",
      });
    });
    const visit1Finish = handle.finish({ isError: false });

    hook.rerender({ room: roomB });
    hook.rerender({ room: roomA });

    act(() => {
      hook.result.current.sendStreamMessage("Follow-up", {
        parentMessageId: "parent-2",
      });
      handle.setMessages([
        textMsg("u2", "user", "Follow-up"),
        textMsg("a2", "assistant", "Working..."),
      ]);
      handle.setStatus("streaming");
    });

    await act(async () => {
      visit1Refresh.resolve(true);
      await visit1Finish;
    });

    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-2");
    expect(hook.result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(hook.result.current.streamOverlayMessages).toHaveLength(2);
    expect(
      hook.result.current.streamOverlayMessages.every(
        (m) => m.parentMessageId === "parent-2",
      ),
    ).toBe(true);

    // Leave A and re-enter A mid-stream: stream still routes to parent-2.
    hook.rerender({ room: roomB });
    hook.rerender({ room: roomA });
    act(() => handle.setStatus("streaming"));

    expect(hook.result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(hook.result.current.streamOverlayMessages).toEqual([
      expect.objectContaining({
        id: RESUME_PENDING_STREAM_MESSAGE_ID,
        parentMessageId: "parent-2",
      }),
    ]);
  });

  it("keeps a newer thread turn's stored parent and routes mid-stream re-entry across keyed remounts", async () => {
    const visit1Refresh = Promise.withResolvers<boolean>();
    const visit1 = mountStream(vi.fn(() => visit1Refresh.promise));

    act(() => {
      visit1.hook.result.current.sendStreamMessage("Visit 1", {
        parentMessageId: "parent-1",
      });
    });
    const visit1Finish = visit1.handle.finish({ isError: false });
    visit1.hook.unmount();

    const visit2 = mountStream();
    act(() => {
      visit2.hook.result.current.sendStreamMessage("Visit 2", {
        parentMessageId: "parent-2",
      });
      visit2.handle.setMessages([
        textMsg("u2", "user", "Visit 2"),
        textMsg("a2", "assistant", "Thinking..."),
      ]);
      visit2.handle.setStatus("streaming");
    });

    await act(async () => {
      visit1Refresh.resolve(true);
      await visit1Finish;
    });

    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-2");
    expect(visit2.hook.result.current.activeStreamParentMessageId).toBe(
      "parent-2",
    );
    expect(visit2.hook.result.current.streamOverlayMessages).toHaveLength(2);

    visit2.hook.unmount();
    const visit3 = mountStream();
    act(() => visit3.handle.setStatus("streaming"));

    expect(visit3.hook.result.current.activeStreamParentMessageId).toBe(
      "parent-2",
    );
    expect(visit3.hook.result.current.streamOverlayMessages).toEqual([
      expect.objectContaining({
        id: RESUME_PENDING_STREAM_MESSAGE_ID,
        parentMessageId: "parent-2",
      }),
    ]);
  });

  it("clears the stored parent when an earlier finish refresh succeeds after a bare remount without sending", async () => {
    const visit1Refresh = Promise.withResolvers<boolean>();
    const visit1 = mountStream(vi.fn(() => visit1Refresh.promise));

    act(() => {
      visit1.hook.result.current.sendStreamMessage("Visit 1", {
        parentMessageId: "parent-1",
      });
    });
    const visit1Finish = visit1.handle.finish({ isError: false });
    visit1.hook.unmount();

    // Bare remount (GET 204 resume, no new turn sent).
    const visit2 = mountStream();
    expect(chatMock.resumeStream).toHaveBeenCalledTimes(2);

    await act(async () => {
      visit1Refresh.resolve(true);
      await visit1Finish;
    });

    expect(readStoredStreamParentMessageId("room-a")).toBeNull();
    visit2.hook.unmount();

    // Next idle visit does not reopen parent-1.
    const visit3 = mountStream();
    expect(visit3.hook.result.current.activeStreamParentMessageId).toBeNull();
  });

  it("keeps a newer same-room thread turn intact when the previous turn's finish refresh settles late", async () => {
    const turn1Refresh = Promise.withResolvers<boolean>();
    const { hook, handle } = mountStream(vi.fn(() => turn1Refresh.promise));

    act(() => {
      hook.result.current.sendStreamMessage("Turn 1");
    });
    const turn1Finish = handle.finish({ isError: false });

    act(() => {
      hook.result.current.sendStreamMessage("Turn 2", {
        parentMessageId: "parent-2",
      });
      handle.setMessages([textMsg("u2", "user", "Turn 2")]);
      handle.setStatus("streaming");
    });

    await act(async () => {
      turn1Refresh.resolve(true);
      await turn1Finish;
    });

    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-2");
    expect(hook.result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(hook.result.current.streamOverlayMessages).toEqual([
      expect.objectContaining({ id: "stream:u2", parentMessageId: "parent-2" }),
    ]);
  });

  it("clears stored parent and overlay when the current turn settles normally", async () => {
    const onStreamSettled = vi.fn(async () => true);
    const { hook, handle } = mountStream(onStreamSettled);

    act(() => {
      hook.result.current.sendStreamMessage("Reply", {
        parentMessageId: "parent-1",
      });
      handle.setMessages([textMsg("u1", "user", "Reply")]);
    });

    await act(async () => {
      await handle.finish({ isError: false });
    });

    expect(onStreamSettled).toHaveBeenCalledWith("room-a");
    expect(readStoredStreamParentMessageId("room-a")).toBeNull();
    expect(hook.result.current.activeStreamParentMessageId).toBeNull();
    expect(hook.result.current.streamOverlayMessages).toEqual([]);
  });

  it("clears overlay and stored parent when a finish refresh settles after an Activity hide/reveal on the same room", async () => {
    const refresh = Promise.withResolvers<boolean>();
    const onStreamSettled = vi.fn(() => refresh.promise);
    let latest: ReturnType<typeof useCoworkerDirectRoomStream> | null = null;

    function Probe() {
      latest = useCoworkerDirectRoomStream({
        room: roomA,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled,
      });
      return null;
    }

    const { rerender } = render(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );
    const handle = chatMock.handles[0]!;

    act(() => {
      latest!.sendStreamMessage("Reply", { parentMessageId: "parent-1" });
      handle.setMessages([
        textMsg("u1", "user", "Reply"),
        textMsg("a1", "assistant", "Done"),
      ]);
    });

    const finishPromise = handle.finish({ isError: false });

    rerender(
      <Activity mode="hidden">
        <Probe />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <Probe />
      </Activity>,
    );

    expect(chatMock.resumeStream).toHaveBeenCalledTimes(2);
    expect(chatMock.handles).toHaveLength(1);

    await act(async () => {
      refresh.resolve(true);
      await finishPromise;
    });

    expect(readStoredStreamParentMessageId("room-a")).toBeNull();
    expect(latest!.activeStreamParentMessageId).toBeNull();
    expect(latest!.streamOverlayMessages).toEqual([]);
  });
});
