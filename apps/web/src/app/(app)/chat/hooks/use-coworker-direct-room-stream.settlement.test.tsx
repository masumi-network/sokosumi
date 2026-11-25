import type { ChatRoom } from "@sokosumi/core-client";
import { act, renderHook } from "@testing-library/react";
import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RESUME_PENDING_STREAM_MESSAGE_ID,
  readStoredStreamParentMessageId,
  useCoworkerDirectRoomStream,
} from "./use-coworker-direct-room-stream";

type ChatOptions = {
  id?: string;
  onError?: (error: Error) => void;
  onFinish?: (event: { isError: boolean; isAbort?: boolean }) => Promise<void>;
};

interface MockChatHandle {
  get id(): string | undefined;
  setMessages: (messages: UIMessage[]) => void;
  setStatus: (status: string) => void;
  finish: (event?: { isError?: boolean; isAbort?: boolean }) => Promise<void>;
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
          get id() {
            return latestOptionsRef.current.id;
          },
          setMessages,
          setStatus,
          finish: async (event = {}) => {
            await latestOptionsRef.current.onFinish?.({
              isError: event.isError ?? false,
              isAbort: event.isAbort,
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

function makeRoom(id: string): ChatRoom {
  return {
    id,
    userMembers: [{ id: "user-1", name: "Ada", image: null }],
    coworkerMembers: [{ id: "cow-1", name: "Jamal", slug: "jamal" }],
  } as unknown as ChatRoom;
}

const roomA = makeRoom("room-a");
const roomB = makeRoom("room-b");

beforeEach(() => {
  vi.clearAllMocks();
  chatMock.handles.length = 0;
  sessionStorage.clear();
});

describe("useCoworkerDirectRoomStream stale finish settlement", () => {
  it("keeps a newer thread turn's stored parent and routes mid-stream re-entry after in-place A -> B -> A", async () => {
    const visit1Refresh = Promise.withResolvers<boolean>();
    const onStreamSettled = vi.fn((roomId: string) => {
      if (roomId === "room-a" && onStreamSettled.mock.calls.length === 1) {
        return visit1Refresh.promise;
      }
      return Promise.resolve(true);
    });

    const hook = renderHook(
      ({ room }: { room: ChatRoom }) =>
        useCoworkerDirectRoomStream({
          room,
          enabled: true,
          currentUserId: "user-1",
          organizationSlug: null,
          onStreamSettled,
        }),
      { initialProps: { room: roomA } },
    );
    const handle = chatMock.handles[0];
    expect(handle).toBeDefined();

    // Visit 1 in room A: send a turn and start finish refresh (still in flight).
    act(() => {
      hook.result.current.sendStreamMessage("First question", {
        parentMessageId: "parent-1",
      });
    });
    const visit1FinishPromise = handle!.finish({ isError: false });
    expect(onStreamSettled).toHaveBeenCalledTimes(1);
    expect(onStreamSettled).toHaveBeenCalledWith("room-a");

    // In-place switch A -> B -> A while visit 1's refresh is still pending.
    hook.rerender({ room: roomB });
    hook.rerender({ room: roomA });

    // Visit 2 in room A: start a new thread turn in parent-2.
    act(() => {
      hook.result.current.sendStreamMessage("Thread follow-up", {
        parentMessageId: "parent-2",
      });
      handle!.setMessages([
        {
          id: "u2",
          role: "user",
          parts: [{ type: "text", text: "Thread follow-up" }],
        },
        {
          id: "a2",
          role: "assistant",
          parts: [{ type: "text", text: "Working on it..." }],
        },
      ]);
      handle!.setStatus("streaming");
    });

    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-2");
    expect(hook.result.current.activeStreamParentMessageId).toBe("parent-2");

    // Stale refresh from visit 1 settles now.
    await act(async () => {
      visit1Refresh.resolve(true);
      await visit1FinishPromise;
    });

    // Visit 2's stored parent and active overlay must survive.
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
    act(() => {
      handle!.setStatus("streaming");
    });

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
    const onStreamSettled1 = vi.fn(() => visit1Refresh.promise);

    // Visit 1 mount for room A.
    const visit1 = renderHook(() =>
      useCoworkerDirectRoomStream({
        room: roomA,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled: onStreamSettled1,
      }),
    );
    const visit1Handle = chatMock.handles[0]!;

    act(() => {
      visit1.result.current.sendStreamMessage("Visit 1 turn", {
        parentMessageId: "parent-1",
      });
    });
    const visit1FinishPromise = visit1Handle.finish({ isError: false });
    expect(onStreamSettled1).toHaveBeenCalledWith("room-a");

    // Keyed unmount of room A (e.g. navigating A -> B).
    visit1.unmount();

    // Visit 2 remount for room A: send a new thread turn in parent-2.
    const onStreamSettled2 = vi.fn(async () => true);
    const visit2 = renderHook(() =>
      useCoworkerDirectRoomStream({
        room: roomA,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled: onStreamSettled2,
      }),
    );
    const visit2Handle = chatMock.handles[1]!;

    act(() => {
      visit2.result.current.sendStreamMessage("Visit 2 thread reply", {
        parentMessageId: "parent-2",
      });
      visit2Handle.setMessages([
        {
          id: "u2",
          role: "user",
          parts: [{ type: "text", text: "Visit 2 thread reply" }],
        },
        {
          id: "a2",
          role: "assistant",
          parts: [{ type: "text", text: "Thinking..." }],
        },
      ]);
      visit2Handle.setStatus("streaming");
    });

    // Stale refresh from visit 1 settles after visit 2 started its thread turn.
    await act(async () => {
      visit1Refresh.resolve(true);
      await visit1FinishPromise;
    });

    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-2");
    expect(visit2.result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(visit2.result.current.streamOverlayMessages).toHaveLength(2);

    // Keyed unmount of visit 2, then re-enter room A mid-stream (visit 3).
    visit2.unmount();
    const visit3 = renderHook(() =>
      useCoworkerDirectRoomStream({
        room: roomA,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled: vi.fn(async () => true),
      }),
    );
    const visit3Handle = chatMock.handles[2]!;

    act(() => {
      visit3Handle.setStatus("streaming");
    });

    expect(visit3.result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(visit3.result.current.streamOverlayMessages).toEqual([
      expect.objectContaining({
        id: RESUME_PENDING_STREAM_MESSAGE_ID,
        parentMessageId: "parent-2",
      }),
    ]);

    act(() => {
      visit3Handle.setMessages([
        {
          id: "a2",
          role: "assistant",
          parts: [{ type: "text", text: "Here is the reply" }],
        },
      ]);
    });
    expect(visit3.result.current.streamOverlayMessages).toEqual([
      expect.objectContaining({
        id: "stream:a2",
        parentMessageId: "parent-2",
      }),
    ]);
  });

  it("keeps a newer same-room thread turn intact when the previous turn's finish refresh settles late", async () => {
    const turn1Refresh = Promise.withResolvers<boolean>();
    const onStreamSettled = vi.fn(() => turn1Refresh.promise);

    const hook = renderHook(() =>
      useCoworkerDirectRoomStream({
        room: roomA,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled,
      }),
    );
    const handle = chatMock.handles[0]!;

    act(() => {
      hook.result.current.sendStreamMessage("Turn 1");
    });
    const turn1FinishPromise = handle.finish({ isError: false });

    act(() => {
      hook.result.current.sendStreamMessage("Turn 2 in thread", {
        parentMessageId: "parent-2",
      });
      handle.setMessages([
        {
          id: "u2",
          role: "user",
          parts: [{ type: "text", text: "Turn 2 in thread" }],
        },
      ]);
      handle.setStatus("streaming");
    });

    await act(async () => {
      turn1Refresh.resolve(true);
      await turn1FinishPromise;
    });

    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-2");
    expect(hook.result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(hook.result.current.streamOverlayMessages).toEqual([
      expect.objectContaining({
        id: "stream:u2",
        parentMessageId: "parent-2",
      }),
    ]);
  });

  it("clears stored parent and overlay when the current turn settles normally", async () => {
    const onStreamSettled = vi.fn(async () => true);

    const hook = renderHook(() =>
      useCoworkerDirectRoomStream({
        room: roomA,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled,
      }),
    );
    const handle = chatMock.handles[0]!;

    act(() => {
      hook.result.current.sendStreamMessage("Thread reply", {
        parentMessageId: "parent-1",
      });
      handle.setMessages([
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "Thread reply" }],
        },
      ]);
    });

    await act(async () => {
      await handle.finish({ isError: false });
    });

    expect(onStreamSettled).toHaveBeenCalledWith("room-a");
    expect(readStoredStreamParentMessageId("room-a")).toBeNull();
    expect(hook.result.current.activeStreamParentMessageId).toBeNull();
    expect(hook.result.current.streamOverlayMessages).toEqual([]);
  });

  it("ignores aborted finish callbacks so leaving mid-stream keeps the stored parent for re-entry", async () => {
    const onStreamSettled = vi.fn(async () => true);

    const hook = renderHook(() =>
      useCoworkerDirectRoomStream({
        room: roomA,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled,
      }),
    );
    const handle = chatMock.handles[0]!;

    act(() => {
      hook.result.current.sendStreamMessage("Thread reply", {
        parentMessageId: "parent-2",
      });
    });

    await act(async () => {
      await handle.finish({ isError: false, isAbort: true });
    });

    expect(onStreamSettled).not.toHaveBeenCalled();
    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-2");
    expect(hook.result.current.activeStreamParentMessageId).toBe("parent-2");
  });
});
