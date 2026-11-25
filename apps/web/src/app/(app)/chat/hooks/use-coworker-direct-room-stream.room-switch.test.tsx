import type { ChatRoom } from "@sokosumi/core-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useCoworkerDirectRoomStream,
  writeStoredStreamParentMessageId,
} from "./use-coworker-direct-room-stream";

const hoisted = vi.hoisted(() => ({
  toastError: vi.fn(),
  messageStart: vi.fn(),
}));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { error: hoisted.toastError } }));
vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: { messageStart: hoisted.messageStart },
}));

function makeRoom(id: string): ChatRoom {
  return {
    id,
    userMembers: [{ id: "user-1", name: "Ada", image: null }],
    coworkerMembers: [{ id: `cow-${id}`, name: `Coworker ${id}`, slug: id }],
  } as unknown as ChatRoom;
}

interface ControlledSseStream {
  response: Response;
  push: (event: Record<string, unknown>) => void;
  close: () => void;
  signal: AbortSignal | undefined;
}

function createControlledSseStream(signal?: AbortSignal): ControlledSseStream {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
  });
  signal?.addEventListener("abort", () => {
    try {
      controller.error(new DOMException("Aborted", "AbortError"));
    } catch {
      // Stream may already be closed.
    }
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
      },
    }),
    push(event) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    close() {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
    signal,
  };
}

describe("useCoworkerDirectRoomStream room switching (real useChat)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    sessionStorage.clear();
  });

  it("drops room A stream overlay, aborts room A, and resumes room B without leaking messages or parent id", async () => {
    const roomA = makeRoom("room-a");
    const roomB = makeRoom("room-b");
    let roomAStream: ControlledSseStream | null = null;
    const fetchedUrls: string[] = [];

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchedUrls.push(url);
      if (url === "/api/chat") {
        roomAStream = createControlledSseStream(init?.signal ?? undefined);
        return roomAStream.response;
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const onStreamSettled = vi.fn(async () => true);

    const { result, rerender, unmount } = renderHook(
      ({ room, enabled }: { room: ChatRoom | null; enabled: boolean }) =>
        useCoworkerDirectRoomStream({
          room,
          enabled,
          currentUserId: "user-1",
          organizationSlug: null,
          onStreamSettled,
        }),
      { initialProps: { room: roomA as ChatRoom | null, enabled: true } },
    );

    await waitFor(() => {
      expect(fetchedUrls).toContain("/api/chat/room-a/stream");
    });

    // Start a thread stream in room A and receive a partial reply chunk.
    act(() => {
      expect(
        result.current.sendStreamMessage("Hello room A", {
          parentMessageId: "parent-a",
        }),
      ).toBe(true);
    });

    await waitFor(() => {
      expect(roomAStream).not.toBeNull();
    });

    act(() => {
      roomAStream?.push({ type: "start", messageId: "asst-a1" });
      roomAStream?.push({ type: "text-start", id: "t1" });
      roomAStream?.push({
        type: "text-delta",
        id: "t1",
        delta: "Working on A",
      });
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
      expect(result.current.streamOverlayMessages).toHaveLength(2);
    });
    expect(result.current.activeStreamParentMessageId).toBe("parent-a");
    expect(
      result.current.streamOverlayMessages.every(
        (m) => m.roomId === "room-a" && m.parentMessageId === "parent-a",
      ),
    ).toBe(true);

    // Switch to room B while room A is mid-stream.
    rerender({ room: roomB, enabled: true });

    // Room B must never see room A's overlay messages, streaming state, or parent id.
    expect(result.current.streamOverlayMessages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.activeStreamParentMessageId).toBeNull();

    await waitFor(() => {
      expect(roomAStream?.signal?.aborted).toBe(true);
      expect(fetchedUrls).toContain("/api/chat/room-b/stream");
    });

    // Aborting room A must not settle room B or clear room A's stored thread parent.
    expect(onStreamSettled).not.toHaveBeenCalled();

    // Leaving room B (null) also keeps overlay empty and does not call resume.
    const fetchCountBeforeLeave = fetchedUrls.length;
    rerender({ room: null, enabled: false });
    expect(result.current.streamOverlayMessages).toEqual([]);
    expect(result.current.activeStreamParentMessageId).toBeNull();
    expect(fetchedUrls.length).toBe(fetchCountBeforeLeave);

    unmount();
  });

  it("preserves room B's resumed thread stream when switching from streaming room A into room B", async () => {
    const roomA = makeRoom("room-a");
    const roomB = makeRoom("room-b");
    let roomAStream: ControlledSseStream | null = null;
    let roomBResumeStream: ControlledSseStream | null = null;

    writeStoredStreamParentMessageId("room-b", "parent-b");

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/chat") {
        roomAStream = createControlledSseStream(init?.signal ?? undefined);
        return roomAStream.response;
      }
      if (url === "/api/chat/room-b/stream") {
        roomBResumeStream = createControlledSseStream(
          init?.signal ?? undefined,
        );
        return roomBResumeStream.response;
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const onStreamSettled = vi.fn(async () => true);

    const { result, rerender, unmount } = renderHook(
      ({ room }: { room: ChatRoom | null }) =>
        useCoworkerDirectRoomStream({
          room,
          enabled: Boolean(room),
          currentUserId: "user-1",
          organizationSlug: null,
          onStreamSettled,
        }),
      { initialProps: { room: roomA as ChatRoom | null } },
    );

    act(() => {
      result.current.sendStreamMessage("Streaming in A", {
        parentMessageId: "parent-a",
      });
    });

    await waitFor(() => {
      expect(roomAStream).not.toBeNull();
    });

    act(() => {
      roomAStream?.push({ type: "start", messageId: "asst-a1" });
      roomAStream?.push({ type: "text-start", id: "t1" });
      roomAStream?.push({ type: "text-delta", id: "t1", delta: "Chunk A" });
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });

    // Switch into room B which has an active thread stream to resume.
    rerender({ room: roomB });
    expect(result.current.activeStreamParentMessageId).toBe("parent-b");

    await waitFor(() => {
      expect(roomBResumeStream).not.toBeNull();
    });

    act(() => {
      roomBResumeStream?.push({ type: "start", messageId: "asst-b1" });
      roomBResumeStream?.push({ type: "text-start", id: "tb1" });
      roomBResumeStream?.push({
        type: "text-delta",
        id: "tb1",
        delta: "Resumed B",
      });
    });

    await waitFor(() => {
      expect(result.current.streamOverlayMessages).toEqual([
        expect.objectContaining({
          roomId: "room-b",
          parentMessageId: "parent-b",
          content: "Resumed B",
        }),
      ]);
    });

    // Room A's abort must not have wiped room B's overlay or stored thread parent.
    expect(result.current.activeStreamParentMessageId).toBe("parent-b");
    expect(onStreamSettled).not.toHaveBeenCalled();

    unmount();
  });

  it("clears failure and failed thread parent across room A -> room B -> room A", async () => {
    const roomA = makeRoom("room-a");
    const roomB = makeRoom("room-b");
    let postCount = 0;

    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/chat") {
        postCount += 1;
        return new Response(
          JSON.stringify({
            error: "Forbidden",
            message: "Billing setup required.",
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const onStreamSettled = vi.fn(async () => true);

    const { result, rerender, unmount } = renderHook(
      ({ room }: { room: ChatRoom | null }) =>
        useCoworkerDirectRoomStream({
          room,
          enabled: Boolean(room),
          currentUserId: "user-1",
          organizationSlug: null,
          onStreamSettled,
        }),
      { initialProps: { room: roomA as ChatRoom | null } },
    );

    act(() => {
      result.current.sendStreamMessage("Will fail", {
        parentMessageId: "parent-a",
      });
    });

    await waitFor(() => {
      expect(result.current.streamOverlayMessages).toEqual([
        expect.objectContaining({
          roomId: "room-a",
          parentMessageId: "parent-a",
          content: "Will fail",
          metadata: expect.objectContaining({
            outbound_delivery_status: "failed",
            outbound_error: "Billing setup required.",
          }),
        }),
      ]);
    });
    expect(result.current.activeStreamParentMessageId).toBe("parent-a");
    expect(postCount).toBe(1);

    // Leave room A for room B.
    rerender({ room: roomB });
    expect(result.current.streamOverlayMessages).toEqual([]);
    expect(result.current.activeStreamParentMessageId).toBeNull();

    // Return to room A: neither the old failure nor the old failed thread parent may leak back.
    rerender({ room: roomA });
    expect(result.current.streamOverlayMessages).toEqual([]);
    expect(result.current.activeStreamParentMessageId).toBeNull();

    // Retrying after leaving and returning must be a no-op (no stale failureRef).
    act(() => {
      result.current.retryFailedStreamMessage();
    });
    expect(postCount).toBe(1);

    unmount();
  });
});
