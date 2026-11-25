import type { ChatRoom } from "@sokosumi/core-client";
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readStoredStreamParentMessageId,
  type UseCoworkerDirectRoomStreamResult,
  useCoworkerDirectRoomStream,
  writeStoredStreamParentMessageId,
} from "./use-coworker-direct-room-stream";

interface ControlledStream {
  stream: ReadableStream<UIMessageChunk>;
  emit: (chunk: UIMessageChunk) => void;
  emitText: (messageId: string, text: string) => void;
  finish: (messageId: string, text: string) => void;
  finishOpenText: (messageId: string) => void;
  close: () => void;
  readonly aborted: boolean;
}

type SendOptions = Parameters<ChatTransport<UIMessage>["sendMessages"]>[0];
type ReconnectOptions = Parameters<
  ChatTransport<UIMessage>["reconnectToStream"]
>[0];

type SendHandler = (
  options: SendOptions,
) => Promise<ReadableStream<UIMessageChunk>>;
type ReconnectHandler = (
  options: ReconnectOptions,
) => Promise<ReadableStream<UIMessageChunk> | null>;

function createControlledStream(abortSignal?: AbortSignal): ControlledStream {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>;
  let closed = false;
  let aborted = abortSignal?.aborted ?? false;
  abortSignal?.addEventListener(
    "abort",
    () => {
      aborted = true;
    },
    { once: true },
  );

  const stream = new ReadableStream<UIMessageChunk>({
    start(nextController) {
      controller = nextController;
    },
    cancel() {
      closed = true;
    },
  });

  function emit(chunk: UIMessageChunk): void {
    if (!closed) {
      controller.enqueue(chunk);
    }
  }

  function close(): void {
    if (!closed) {
      closed = true;
      controller.close();
    }
  }

  function emitText(messageId: string, text: string): void {
    emit({ type: "start", messageId });
    emit({ type: "text-start", id: `${messageId}-text` });
    emit({ type: "text-delta", id: `${messageId}-text`, delta: text });
  }

  function finishOpenText(messageId: string): void {
    emit({ type: "text-end", id: `${messageId}-text` });
    emit({ type: "finish", finishReason: "stop" });
    close();
  }

  function finish(messageId: string, text: string): void {
    emitText(messageId, text);
    finishOpenText(messageId);
  }

  return {
    stream,
    emit,
    emitText,
    finish,
    finishOpenText,
    close,
    get aborted() {
      return aborted;
    },
  };
}

const transportState = vi.hoisted(() => ({
  sendQueue: [] as SendHandler[],
  reconnectQueue: [] as ReconnectHandler[],
  sentStreams: [] as Array<{
    chatId: string;
    trigger: SendOptions["trigger"];
    body: unknown;
    controlled: ControlledStream;
  }>,
  reconnectCalls: [] as string[],
  toastError: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();

  class FakeDefaultChatTransport implements ChatTransport<UIMessage> {
    readonly resumeStreamIsReplay = true;

    sendMessages: ChatTransport<UIMessage>["sendMessages"] = async (
      options,
    ) => {
      const handler = transportState.sendQueue.shift();
      if (handler) {
        return handler(options);
      }
      const controlled = createControlledStream(options.abortSignal);
      transportState.sentStreams.push({
        chatId: options.chatId,
        trigger: options.trigger,
        body: options.body,
        controlled,
      });
      return controlled.stream;
    };

    reconnectToStream: ChatTransport<UIMessage>["reconnectToStream"] = async (
      options,
    ) => {
      transportState.reconnectCalls.push(options.chatId);
      const handler = transportState.reconnectQueue.shift();
      if (handler) {
        return handler(options);
      }
      return null;
    };
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

function makeRoom(id: string): ChatRoom {
  return {
    id,
    userMembers: [
      {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "online",
      },
    ],
    coworkerMembers: [
      {
        id: "cow-1",
        name: "Jamal",
        slug: "jamal",
        caption: null,
        image: null,
        presence: "online",
      },
    ],
  } as unknown as ChatRoom;
}

const roomA = makeRoom("room-a");
const roomB = makeRoom("room-b");

interface SettledCall {
  roomId: string;
  resolve: (settled: boolean) => void;
}

function createSettledController() {
  const calls: SettledCall[] = [];
  const onStreamSettled = vi.fn((roomId: string) => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    calls.push({ roomId, resolve });
    return promise;
  });
  return { calls, onStreamSettled };
}

function renderKeyedRoom(
  initialRoom: ChatRoom,
  onStreamSettled: (roomId: string) => Promise<boolean>,
) {
  let latest!: UseCoworkerDirectRoomStreamResult;

  function RoomHost({ room }: { room: ChatRoom }) {
    latest = useCoworkerDirectRoomStream({
      room,
      enabled: true,
      currentUserId: "user-1",
      organizationSlug: null,
      onStreamSettled,
    });
    return null;
  }

  const view = render(<RoomHost key={initialRoom.id} room={initialRoom} />);

  return {
    get current() {
      return latest;
    },
    switchRoom(nextRoom: ChatRoom) {
      view.rerender(<RoomHost key={nextRoom.id} room={nextRoom} />);
    },
    unmount: view.unmount,
  };
}

function renderActivityRoom(
  room: ChatRoom,
  onStreamSettled: (roomId: string) => Promise<boolean>,
) {
  let latest!: UseCoworkerDirectRoomStreamResult;

  function RoomHost() {
    latest = useCoworkerDirectRoomStream({
      room,
      enabled: true,
      currentUserId: "user-1",
      organizationSlug: null,
      onStreamSettled,
    });
    return null;
  }

  const view = render(
    <Activity mode="visible">
      <RoomHost />
    </Activity>,
  );

  return {
    get current() {
      return latest;
    },
    setMode(mode: "visible" | "hidden") {
      view.rerender(
        <Activity mode={mode}>
          <RoomHost />
        </Activity>,
      );
    },
    unmount: view.unmount,
  };
}

beforeEach(() => {
  transportState.sendQueue.length = 0;
  transportState.reconnectQueue.length = 0;
  transportState.sentStreams.length = 0;
  transportState.reconnectCalls.length = 0;
  transportState.toastError.mockClear();
  sessionStorage.clear();
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    for (const entry of transportState.sentStreams) {
      entry.controlled.close();
    }
  });
});

describe("useCoworkerDirectRoomStream settlement", () => {
  it("clears overlay and stored parent after normal finish and merge", async () => {
    const settled = createSettledController();
    const { result } = renderHook(() =>
      useCoworkerDirectRoomStream({
        room: roomA,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled: settled.onStreamSettled,
      }),
    );

    act(() => {
      result.current.sendStreamMessage("Hello", {
        parentMessageId: "parent-1",
      });
    });

    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    act(() => {
      transportState.sentStreams[0]?.controlled.finish("asst-1", "Hi there");
    });

    await waitFor(() => expect(settled.calls).toHaveLength(1));
    expect(settled.calls[0]?.roomId).toBe("room-a");
    expect(result.current.streamOverlayMessages).toHaveLength(2);
    expect(result.current.activeStreamParentMessageId).toBe("parent-1");
    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-1");

    await act(async () => {
      settled.calls[0]?.resolve(true);
    });

    await waitFor(() => {
      expect(result.current.streamOverlayMessages).toEqual([]);
      expect(result.current.activeStreamParentMessageId).toBeNull();
      expect(readStoredStreamParentMessageId("room-a")).toBeNull();
    });
  });

  it("keeps visit 2's thread parent and mid-stream re-entry routing when visit 1's refresh settles after keyed remount A -> B -> A", async () => {
    const settled = createSettledController();
    const host = renderKeyedRoom(roomA, settled.onStreamSettled);

    // Visit 1 sends a thread reply and finishes; its refresh stays in flight.
    act(() => {
      host.current.sendStreamMessage("Visit 1 reply", {
        parentMessageId: "parent-1",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    act(() => {
      transportState.sentStreams[0]?.controlled.finish("asst-1", "Reply 1");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(1));

    // Keyed remount A -> B -> A.
    act(() => {
      host.switchRoom(roomB);
    });
    act(() => {
      host.switchRoom(roomA);
    });

    // Visit 2 sends a new thread reply that is still streaming.
    act(() => {
      host.current.sendStreamMessage("Visit 2 reply", {
        parentMessageId: "parent-2",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(2));
    act(() => {
      transportState.sentStreams[1]?.controlled.emitText("asst-2", "Working");
    });
    await waitFor(() =>
      expect(host.current.streamOverlayMessages).toHaveLength(2),
    );

    // Visit 1's stale refresh settles now.
    await act(async () => {
      settled.calls[0]?.resolve(true);
    });

    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-2");
    expect(host.current.activeStreamParentMessageId).toBe("parent-2");
    expect(host.current.streamOverlayMessages).toHaveLength(2);

    // Mid-stream re-entry to room A routes the resumed stream to parent-2.
    act(() => {
      host.switchRoom(roomB);
    });
    let resumedStream: ControlledStream | null = null;
    transportState.reconnectQueue.push(async (options) => {
      resumedStream = createControlledStream(options.abortSignal);
      return resumedStream.stream;
    });
    await act(async () => {
      host.switchRoom(roomA);
    });
    await waitFor(() => expect(resumedStream).not.toBeNull());
    act(() => {
      resumedStream?.emitText("asst-2", "Still working");
    });

    await waitFor(() => {
      expect(host.current.activeStreamParentMessageId).toBe("parent-2");
      expect(host.current.streamOverlayMessages).toEqual([
        expect.objectContaining({
          parentMessageId: "parent-2",
          content: "Still working",
        }),
      ]);
    });

    await act(async () => {
      resumedStream?.finishOpenText("asst-2");
    });
  });

  it("clears the stored parent after a keyed remount with no new send (round 2)", async () => {
    const settled = createSettledController();
    const host = renderKeyedRoom(roomA, settled.onStreamSettled);

    act(() => {
      host.current.sendStreamMessage("Visit 1 reply", {
        parentMessageId: "parent-1",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    act(() => {
      transportState.sentStreams[0]?.controlled.finish("asst-1", "Done");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(1));

    act(() => {
      host.switchRoom(roomB);
    });
    act(() => {
      host.switchRoom(roomA);
    });

    await act(async () => {
      settled.calls[0]?.resolve(true);
    });

    await waitFor(() => {
      expect(readStoredStreamParentMessageId("room-a")).toBeNull();
    });
  });

  it("keeps the new thread parent in storage and state on in-place A -> B -> A", async () => {
    const settled = createSettledController();
    const { result, rerender } = renderHook(
      ({ room }: { room: ChatRoom }) =>
        useCoworkerDirectRoomStream({
          room,
          enabled: true,
          currentUserId: "user-1",
          organizationSlug: null,
          onStreamSettled: settled.onStreamSettled,
        }),
      { initialProps: { room: roomA } },
    );

    act(() => {
      result.current.sendStreamMessage("First reply", {
        parentMessageId: "parent-1",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    act(() => {
      transportState.sentStreams[0]?.controlled.finish("asst-1", "Done 1");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(1));

    rerender({ room: roomB });
    rerender({ room: roomA });

    act(() => {
      result.current.sendStreamMessage("Second reply", {
        parentMessageId: "parent-2",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(2));
    act(() => {
      transportState.sentStreams[1]?.controlled.emitText("asst-2", "Live");
    });
    await waitFor(() =>
      expect(result.current.streamOverlayMessages).toHaveLength(2),
    );

    await act(async () => {
      settled.calls[0]?.resolve(true);
    });

    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-2");
    expect(result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(result.current.streamOverlayMessages).toHaveLength(2);
  });

  it("binds aborted finish on in-place A -> B to room A and never touches room B", async () => {
    let selectedRoomId = "room-a";
    const settledRooms: string[] = [];
    const onStreamSettled = vi.fn(async (roomId: string) => {
      settledRooms.push(roomId);
      return roomId === selectedRoomId;
    });

    writeStoredStreamParentMessageId("room-b", "parent-b");

    const { result, rerender } = renderHook(
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

    act(() => {
      result.current.sendStreamMessage("Room A turn", {
        parentMessageId: "parent-a",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    act(() => {
      transportState.sentStreams[0]?.controlled.emitText("asst-a", "Streaming");
    });
    await waitFor(() =>
      expect(result.current.streamOverlayMessages).toHaveLength(2),
    );

    // Room B has a live resumable stream when switched to in place.
    let roomBStream: ControlledStream | null = null;
    transportState.reconnectQueue.push(async (options) => {
      roomBStream = createControlledStream(options.abortSignal);
      return roomBStream.stream;
    });

    selectedRoomId = "room-b";
    await act(async () => {
      rerender({ room: roomB });
    });

    await waitFor(() => expect(settledRooms).toEqual(["room-a"]));
    await waitFor(() => expect(roomBStream).not.toBeNull());
    act(() => {
      roomBStream?.emitText("asst-b", "Room B live");
    });
    await waitFor(() => {
      expect(result.current.activeStreamParentMessageId).toBe("parent-b");
      expect(readStoredStreamParentMessageId("room-b")).toBe("parent-b");
      expect(result.current.streamOverlayMessages).toEqual([
        expect.objectContaining({
          parentMessageId: "parent-b",
          content: "Room B live",
        }),
      ]);
    });

    await act(async () => {
      roomBStream?.close();
    });
  });

  it("clears overlay and parent after Activity hide and reveal while finish refresh is in flight (round 1)", async () => {
    const settled = createSettledController();
    const host = renderActivityRoom(roomA, settled.onStreamSettled);

    act(() => {
      host.current.sendStreamMessage("Before hide", {
        parentMessageId: "parent-1",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    act(() => {
      transportState.sentStreams[0]?.controlled.finish("asst-1", "Done");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(1));

    act(() => {
      host.setMode("hidden");
    });
    act(() => {
      host.setMode("visible");
    });

    await act(async () => {
      settled.calls[0]?.resolve(true);
    });

    await waitFor(() => {
      expect(host.current.streamOverlayMessages).toEqual([]);
      expect(host.current.activeStreamParentMessageId).toBeNull();
      expect(readStoredStreamParentMessageId("room-a")).toBeNull();
    });
  });

  it("keeps resumed turn's overlay and parent when abort refresh settles after hide, reveal, and live resume", async () => {
    const settled = createSettledController();
    const host = renderActivityRoom(roomA, settled.onStreamSettled);

    act(() => {
      host.current.sendStreamMessage("Mid-stream", {
        parentMessageId: "parent-1",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    act(() => {
      transportState.sentStreams[0]?.controlled.emitText("asst-1", "Part 1");
    });
    await waitFor(() =>
      expect(host.current.streamOverlayMessages).toHaveLength(2),
    );

    // Hide aborts the live stream; its abort finish refresh stays in flight.
    act(() => {
      host.setMode("hidden");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(1));

    // Reveal resumes with a live stream before the abort refresh resolves.
    let resumedStream!: ControlledStream;
    transportState.reconnectQueue.push(async (options) => {
      resumedStream = createControlledStream(options.abortSignal);
      resumedStream.emitText("asst-1", "Part 1 + Part 2");
      return resumedStream.stream;
    });

    act(() => {
      host.setMode("visible");
    });
    await waitFor(() => expect(host.current.isStreaming).toBe(true));

    // Abort's refresh resolves while the resumed stream is active.
    await act(async () => {
      settled.calls[0]?.resolve(true);
    });

    expect(host.current.streamOverlayMessages).toHaveLength(2);
    expect(host.current.activeStreamParentMessageId).toBe("parent-1");
    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-1");

    // Resumed turn finishes and settles cleanly.
    act(() => {
      resumedStream.finishOpenText("asst-1");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(2));
    await act(async () => {
      settled.calls[1]?.resolve(true);
    });

    await waitFor(() => {
      expect(host.current.streamOverlayMessages).toEqual([]);
      expect(host.current.activeStreamParentMessageId).toBeNull();
      expect(readStoredStreamParentMessageId("room-a")).toBeNull();
    });
  });

  it("clears overlay and parent when hide aborts mid-stream and reveal gets 204", async () => {
    const settled = createSettledController();
    const host = renderActivityRoom(roomA, settled.onStreamSettled);

    act(() => {
      host.current.sendStreamMessage("Mid-stream 204", {
        parentMessageId: "parent-1",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    act(() => {
      transportState.sentStreams[0]?.controlled.emitText("asst-1", "Partial");
    });
    await waitFor(() =>
      expect(host.current.streamOverlayMessages).toHaveLength(2),
    );

    act(() => {
      host.setMode("hidden");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(1));

    // Reveal gets 204 (default reconnect returns null).
    act(() => {
      host.setMode("visible");
    });

    await act(async () => {
      settled.calls[0]?.resolve(true);
    });

    await waitFor(() => {
      expect(host.current.streamOverlayMessages).toEqual([]);
      expect(host.current.activeStreamParentMessageId).toBeNull();
      expect(readStoredStreamParentMessageId("room-a")).toBeNull();
    });
  });

  it("settles overlapping refreshes from finish, hide, resume replay, and second finish once without breaking either (round 3)", async () => {
    const settled = createSettledController();
    const host = renderActivityRoom(roomA, settled.onStreamSettled);

    act(() => {
      host.current.sendStreamMessage("Turn 1", {
        parentMessageId: "parent-1",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    act(() => {
      transportState.sentStreams[0]?.controlled.finish("asst-1", "Done");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(1));

    act(() => {
      host.setMode("hidden");
    });

    // Reveal replays the completed assistant message and fires a second finish.
    transportState.reconnectQueue.push(async (options) => {
      const replay = createControlledStream(options.abortSignal);
      replay.finish("asst-1", "Done");
      return replay.stream;
    });
    act(() => {
      host.setMode("visible");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(2));

    // First refresh resolves after replay replaced chat.messages -> no-op.
    await act(async () => {
      settled.calls[0]?.resolve(true);
    });
    expect(host.current.streamOverlayMessages).toHaveLength(2);
    expect(host.current.activeStreamParentMessageId).toBe("parent-1");
    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-1");

    // Second refresh matches the replayed messages array -> clears cleanly.
    await act(async () => {
      settled.calls[1]?.resolve(true);
    });
    await waitFor(() => {
      expect(host.current.streamOverlayMessages).toEqual([]);
      expect(host.current.activeStreamParentMessageId).toBeNull();
      expect(readStoredStreamParentMessageId("room-a")).toBeNull();
    });
  });

  it("keeps the newer turn's overlay and parent when an older refresh settles on the same Chat", async () => {
    const settled = createSettledController();
    const { result } = renderHook(() =>
      useCoworkerDirectRoomStream({
        room: roomA,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled: settled.onStreamSettled,
      }),
    );

    act(() => {
      result.current.sendStreamMessage("Turn 1", {
        parentMessageId: "parent-1",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    act(() => {
      transportState.sentStreams[0]?.controlled.finish("asst-1", "Reply 1");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(1));

    // Start turn 2 before turn 1's refresh resolves.
    act(() => {
      result.current.sendStreamMessage("Turn 2", {
        parentMessageId: "parent-2",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(2));
    act(() => {
      transportState.sentStreams[1]?.controlled.emitText("asst-2", "Reply 2");
    });
    await waitFor(() =>
      expect(result.current.streamOverlayMessages).toHaveLength(2),
    );

    await act(async () => {
      settled.calls[0]?.resolve(true);
    });

    expect(result.current.streamOverlayMessages).toHaveLength(2);
    expect(result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-2");

    act(() => {
      transportState.sentStreams[1]?.controlled.finishOpenText("asst-2");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(2));
    await act(async () => {
      settled.calls[1]?.resolve(true);
    });

    await waitFor(() => {
      expect(result.current.streamOverlayMessages).toEqual([]);
      expect(result.current.activeStreamParentMessageId).toBeNull();
      expect(readStoredStreamParentMessageId("room-a")).toBeNull();
    });
  });

  it("keeps the stored parent when the same thread is replied to twice across a keyed remount", async () => {
    const settled = createSettledController();
    const host = renderKeyedRoom(roomA, settled.onStreamSettled);

    // Visit 1 replies in parent-1.
    act(() => {
      host.current.sendStreamMessage("Thread reply 1", {
        parentMessageId: "parent-1",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    act(() => {
      transportState.sentStreams[0]?.controlled.finish("asst-1", "Answer 1");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(1));

    // Keyed remount A -> B -> A, then visit 2 replies in the SAME parent-1.
    act(() => {
      host.switchRoom(roomB);
    });
    act(() => {
      host.switchRoom(roomA);
    });
    act(() => {
      host.current.sendStreamMessage("Thread reply 2", {
        parentMessageId: "parent-1",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(2));
    act(() => {
      transportState.sentStreams[1]?.controlled.emitText("asst-2", "Answer 2");
    });

    // Visit 1's stale refresh settles: same parent id, different per-turn token.
    await act(async () => {
      settled.calls[0]?.resolve(true);
    });

    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-1");
    expect(host.current.activeStreamParentMessageId).toBe("parent-1");
    expect(host.current.streamOverlayMessages).toHaveLength(2);
  });

  it("keeps a failed turn until Retry and settles cleanly after Retry finishes", async () => {
    const settled = createSettledController();
    const { result } = renderHook(() =>
      useCoworkerDirectRoomStream({
        room: roomA,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled: settled.onStreamSettled,
      }),
    );

    transportState.sendQueue.push(async () => {
      throw new Error(
        JSON.stringify({ error: "Forbidden", message: "Billing needed" }),
      );
    });

    act(() => {
      result.current.sendStreamMessage("Try once", {
        parentMessageId: "parent-1",
      });
    });

    await waitFor(() => expect(settled.calls).toHaveLength(1));
    await act(async () => {
      settled.calls[0]?.resolve(true);
    });

    expect(result.current.activeStreamParentMessageId).toBe("parent-1");
    expect(result.current.streamOverlayMessages).toEqual([
      expect.objectContaining({
        content: "Try once",
        parentMessageId: "parent-1",
        metadata: expect.objectContaining({
          outbound_delivery_status: "failed",
          outbound_error: "Billing needed",
        }),
      }),
    ]);

    // Retry writes a fresh stored parent token and settles on finish.
    act(() => {
      result.current.retryFailedStreamMessage();
    });
    expect(readStoredStreamParentMessageId("room-a")).toBe("parent-1");

    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    expect(transportState.sentStreams[0]?.trigger).toBe("regenerate-message");
    act(() => {
      transportState.sentStreams[0]?.controlled.finish("asst-1", "Recovered");
    });

    await waitFor(() => expect(settled.calls).toHaveLength(2));
    await act(async () => {
      settled.calls[1]?.resolve(true);
    });

    await waitFor(() => {
      expect(result.current.streamOverlayMessages).toEqual([]);
      expect(result.current.activeStreamParentMessageId).toBeNull();
      expect(readStoredStreamParentMessageId("room-a")).toBeNull();
    });
  });

  it("keeps the failed row and its thread parent when an older turn's refresh settles after the next turn fails", async () => {
    const settled = createSettledController();
    const { result } = renderHook(() =>
      useCoworkerDirectRoomStream({
        room: roomA,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled: settled.onStreamSettled,
      }),
    );

    // Turn 1 finishes; its refresh stays in flight.
    act(() => {
      result.current.sendStreamMessage("Turn 1", {
        parentMessageId: "parent-1",
      });
    });
    await waitFor(() => expect(transportState.sentStreams).toHaveLength(1));
    act(() => {
      transportState.sentStreams[0]?.controlled.finish("asst-1", "Done 1");
    });
    await waitFor(() => expect(settled.calls).toHaveLength(1));

    // Turn 2 fails before turn 1's refresh resolves.
    transportState.sendQueue.push(async () => {
      throw new Error(
        JSON.stringify({ error: "Forbidden", message: "Turn 2 failed" }),
      );
    });
    act(() => {
      result.current.sendStreamMessage("Turn 2", {
        parentMessageId: "parent-2",
      });
    });
    await waitFor(() => expect(settled.calls).toHaveLength(2));

    // Turn 1's old refresh resolves now.
    await act(async () => {
      settled.calls[0]?.resolve(true);
    });

    expect(result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(result.current.streamOverlayMessages).toEqual([
      expect.objectContaining({
        content: "Turn 2",
        parentMessageId: "parent-2",
        metadata: expect.objectContaining({
          outbound_delivery_status: "failed",
          outbound_error: "Turn 2 failed",
        }),
      }),
    ]);

    await act(async () => {
      settled.calls[1]?.resolve(true);
    });
  });
});
