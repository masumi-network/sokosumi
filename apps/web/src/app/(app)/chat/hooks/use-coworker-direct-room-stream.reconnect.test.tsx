import type { ChatRoom } from "@sokosumi/core-client";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readStoredStreamParentMessageId,
  useCoworkerDirectRoomStream,
  writeStoredStreamParentMessageId,
} from "./use-coworker-direct-room-stream";

interface ControlledStream {
  stream: ReadableStream<UIMessageChunk>;
  emit: (chunk: UIMessageChunk) => void;
  emitText: (messageId: string, text: string) => void;
  emitTextDelta: (messageId: string, delta: string) => void;
  finishOpenText: (messageId: string) => void;
  finish: (messageId: string, text: string) => void;
  readonly aborted: boolean;
  readonly cancelled: boolean;
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
  let cancelled = false;
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
      cancelled = true;
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

  function emitTextDelta(messageId: string, delta: string): void {
    emit({ type: "text-delta", id: `${messageId}-text`, delta });
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
    emitTextDelta,
    finishOpenText,
    finish,
    get aborted() {
      return aborted;
    },
    get cancelled() {
      return cancelled;
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
  reconnectCalls: [] as Array<{
    chatId: string;
    abortSignal: AbortSignal | undefined;
  }>,
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
      transportState.reconnectCalls.push({
        chatId: options.chatId,
        abortSignal: options.abortSignal,
      });
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

const room = {
  id: "room-1",
  userMembers: [{ id: "user-1", name: "Ada", image: null }],
  coworkerMembers: [{ id: "cow-1", name: "Jamal", slug: "jamal" }],
} as unknown as ChatRoom;

beforeEach(() => {
  transportState.sendQueue = [];
  transportState.reconnectQueue = [];
  transportState.sentStreams = [];
  transportState.reconnectCalls = [];
  transportState.toastError.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("useCoworkerDirectRoomStream delayed reconnect", () => {
  it("discards a pending reconnect replay when a newer send supersedes it", async () => {
    const pendingReconnect =
      Promise.withResolvers<ReadableStream<UIMessageChunk> | null>();
    transportState.reconnectQueue.push(() => pendingReconnect.promise);

    const onStreamSettled = vi.fn(async () => true);

    const { result } = renderHook(() =>
      useCoworkerDirectRoomStream({
        room,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled,
      }),
    );

    await waitFor(() => {
      expect(transportState.reconnectCalls).toHaveLength(1);
    });

    await act(async () => {
      expect(
        result.current.sendStreamMessage("New reply", {
          parentMessageId: "parent-2",
        }),
      ).toBe(true);
    });

    await waitFor(() => {
      expect(transportState.sentStreams).toHaveLength(1);
    });
    // The superseded reconnect GET is aborted without issuing a second GET.
    expect(transportState.reconnectCalls).toHaveLength(1);
    expect(transportState.reconnectCalls[0]?.abortSignal?.aborted).toBe(true);

    const newerReply = transportState.sentStreams[0]!.controlled;

    await act(async () => {
      newerReply.emitText("asst-new", "Fresh chunk");
    });

    await waitFor(() => {
      expect(
        result.current.streamOverlayMessages.map((m) => m.content),
      ).toEqual(["New reply", "Fresh chunk"]);
    });

    // Delayed reconnect resolves with an old replay stream that emits and finishes.
    const oldReplay = createControlledStream();
    oldReplay.finish("asst-old", "Stale replay chunk");

    await act(async () => {
      pendingReconnect.resolve(oldReplay.stream);
      await Promise.resolve();
    });

    // Old replay chunks never land, streaming stays active, parent & overlay survive.
    expect(result.current.streamOverlayMessages.map((m) => m.content)).toEqual([
      "New reply",
      "Fresh chunk",
    ]);
    expect(
      result.current.streamOverlayMessages.every(
        (m) => m.parentMessageId === "parent-2",
      ),
    ).toBe(true);
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(readStoredStreamParentMessageId("room-1")).toBe("parent-2");
    expect(onStreamSettled).not.toHaveBeenCalled();
    expect(oldReplay.cancelled).toBe(true);

    // Newer reply finishes and settles normally.
    await act(async () => {
      newerReply.emitTextDelta("asst-new", " done");
      newerReply.finishOpenText("asst-new");
    });

    await waitFor(() => {
      expect(onStreamSettled).toHaveBeenCalledTimes(1);
      expect(result.current.streamOverlayMessages).toEqual([]);
    });
    expect(result.current.activeStreamParentMessageId).toBeNull();
    expect(readStoredStreamParentMessageId("room-1")).toBeNull();
  });

  it("keeps a newer send with files streaming when a delayed reconnect resolves before the first chunk", async () => {
    const pendingReconnect =
      Promise.withResolvers<ReadableStream<UIMessageChunk> | null>();
    transportState.reconnectQueue.push(() => pendingReconnect.promise);

    const onStreamSettled = vi.fn(async () => true);

    const { result } = renderHook(() =>
      useCoworkerDirectRoomStream({
        room,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled,
      }),
    );

    await waitFor(() => {
      expect(transportState.reconnectCalls).toHaveLength(1);
    });

    await act(async () => {
      expect(
        result.current.sendStreamMessage("Review this", {
          parentMessageId: "parent-2",
          files: [
            {
              url: "https://blob.example/spec.png",
              fileName: "spec.png",
              mediaType: "image/png",
            },
          ],
        }),
      ).toBe(true);
    });

    await waitFor(() => {
      expect(transportState.sentStreams).toHaveLength(1);
      expect(result.current.isStreaming).toBe(true);
    });

    // Old replay resolves while the newer send is still submitted (no chunks yet).
    const oldReplay = createControlledStream();
    oldReplay.finish("asst-old", "Stale replay chunk");

    await act(async () => {
      pendingReconnect.resolve(oldReplay.stream);
      await Promise.resolve();
    });

    expect(oldReplay.cancelled).toBe(true);
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(readStoredStreamParentMessageId("room-1")).toBe("parent-2");
    expect(result.current.streamOverlayMessages.map((m) => m.content)).toEqual([
      "Review this",
    ]);
    expect(onStreamSettled).not.toHaveBeenCalled();

    const newerReply = transportState.sentStreams[0]!.controlled;
    await act(async () => {
      newerReply.emitText("asst-new", "Looks good");
    });

    await waitFor(() => {
      expect(
        result.current.streamOverlayMessages.map((m) => m.content),
      ).toEqual(["Review this", "Looks good"]);
    });

    await act(async () => {
      newerReply.finishOpenText("asst-new");
    });

    await waitFor(() => {
      expect(onStreamSettled).toHaveBeenCalledTimes(1);
      expect(result.current.streamOverlayMessages).toEqual([]);
    });
  });

  it("preserves a newer failed turn when a delayed reconnect resolves afterwards", async () => {
    const pendingReconnect =
      Promise.withResolvers<ReadableStream<UIMessageChunk> | null>();
    transportState.reconnectQueue.push(() => pendingReconnect.promise);

    transportState.sendQueue.push(async () => {
      throw new Error(
        JSON.stringify({ error: "Forbidden", message: "Billing required." }),
      );
    });

    const onStreamSettled = vi.fn(async () => true);

    const { result } = renderHook(() =>
      useCoworkerDirectRoomStream({
        room,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled,
      }),
    );

    await waitFor(() => {
      expect(transportState.reconnectCalls).toHaveLength(1);
    });

    await act(async () => {
      result.current.sendStreamMessage("New reply", {
        parentMessageId: "parent-2",
      });
    });

    await waitFor(() => {
      expect(result.current.streamOverlayMessages[0]?.metadata).toMatchObject({
        outbound_delivery_status: "failed",
        outbound_error: "Billing required.",
      });
    });

    const oldReplay = createControlledStream();
    oldReplay.finish("asst-old", "Stale replay chunk");

    await act(async () => {
      pendingReconnect.resolve(oldReplay.stream);
      await Promise.resolve();
    });

    expect(oldReplay.cancelled).toBe(true);
    expect(result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(result.current.streamOverlayMessages).toHaveLength(1);
    expect(result.current.streamOverlayMessages[0]?.metadata).toMatchObject({
      outbound_delivery_status: "failed",
      outbound_error: "Billing required.",
    });
    expect(transportState.toastError).toHaveBeenCalledTimes(1);
  });

  it("ignores a superseded reconnect error after a newer send starts", async () => {
    const pendingReconnect =
      Promise.withResolvers<ReadableStream<UIMessageChunk> | null>();
    transportState.reconnectQueue.push(() => pendingReconnect.promise);

    const onStreamSettled = vi.fn(async () => true);

    const { result } = renderHook(() =>
      useCoworkerDirectRoomStream({
        room,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled,
      }),
    );

    await waitFor(() => {
      expect(transportState.reconnectCalls).toHaveLength(1);
    });

    await act(async () => {
      result.current.sendStreamMessage("New reply", {
        parentMessageId: "parent-2",
      });
    });

    await waitFor(() => {
      expect(transportState.sentStreams).toHaveLength(1);
    });

    await act(async () => {
      pendingReconnect.reject(new Error("Reconnect failed"));
      await Promise.resolve();
    });

    expect(transportState.toastError).not.toHaveBeenCalled();
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.activeStreamParentMessageId).toBe("parent-2");
    expect(readStoredStreamParentMessageId("room-1")).toBe("parent-2");

    const newerReply = transportState.sentStreams[0]!.controlled;
    await act(async () => {
      newerReply.finish("asst-new", "Still works");
    });

    await waitFor(() => {
      expect(onStreamSettled).toHaveBeenCalledTimes(1);
      expect(result.current.streamOverlayMessages).toEqual([]);
    });
  });

  it("resumes and settles a reconnect normally when no newer send happens", async () => {
    writeStoredStreamParentMessageId("room-1", "parent-1");

    const pendingReconnect =
      Promise.withResolvers<ReadableStream<UIMessageChunk> | null>();
    transportState.reconnectQueue.push(() => pendingReconnect.promise);

    const settleDeferred = Promise.withResolvers<boolean>();
    const onStreamSettled = vi.fn(() => settleDeferred.promise);

    const { result } = renderHook(() =>
      useCoworkerDirectRoomStream({
        room,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled,
      }),
    );

    await waitFor(() => {
      expect(transportState.reconnectCalls).toHaveLength(1);
    });
    expect(result.current.activeStreamParentMessageId).toBe("parent-1");

    const replay = createControlledStream();
    await act(async () => {
      pendingReconnect.resolve(replay.stream);
      replay.emitText("asst-resumed", "Resumed reply");
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
      expect(
        result.current.streamOverlayMessages.map((m) => m.content),
      ).toEqual(["Resumed reply"]);
    });
    expect(result.current.streamOverlayMessages[0]?.parentMessageId).toBe(
      "parent-1",
    );

    await act(async () => {
      replay.finishOpenText("asst-resumed");
    });

    await waitFor(() => {
      expect(onStreamSettled).toHaveBeenCalledWith("room-1");
    });

    await act(async () => {
      settleDeferred.resolve(true);
      await settleDeferred.promise;
    });

    await waitFor(() => {
      expect(result.current.streamOverlayMessages).toEqual([]);
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.activeStreamParentMessageId).toBeNull();
    expect(readStoredStreamParentMessageId("room-1")).toBeNull();
  });

  it("still surfaces a reconnect error when no newer send superseded it", async () => {
    const pendingReconnect =
      Promise.withResolvers<ReadableStream<UIMessageChunk> | null>();
    transportState.reconnectQueue.push(() => pendingReconnect.promise);

    const onStreamSettled = vi.fn(async () => true);

    renderHook(() =>
      useCoworkerDirectRoomStream({
        room,
        enabled: true,
        currentUserId: "user-1",
        organizationSlug: null,
        onStreamSettled,
      }),
    );

    await waitFor(() => {
      expect(transportState.reconnectCalls).toHaveLength(1);
    });

    await act(async () => {
      pendingReconnect.reject(new Error("Stream unavailable"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(transportState.toastError).toHaveBeenCalledWith(
        "Stream unavailable",
      );
    });
  });
});
