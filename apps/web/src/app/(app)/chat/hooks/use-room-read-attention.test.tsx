import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markThreadReadAction } from "@/app/chat/actions";
import { markOrganizationChatRoomReadAction } from "@/components/chat/organization-chat-list.actions";
import {
  applyRoomReadOverlays,
  clearRoomReadOverlays,
} from "@/components/chat/room-read-overlay";
import type { ChatRoom } from "@/lib/clients/generated/core";

import { useRoomReadAttention } from "./use-room-read-attention";

vi.mock("@/app/chat/actions", () => ({ markThreadReadAction: vi.fn() }));
vi.mock("@/components/chat/organization-chat-list.actions", () => ({
  markOrganizationChatRoomReadAction: vi.fn(),
}));

function room(id = "room-1"): ChatRoom {
  return {
    id,
    organizationId: "org-1",
    organizationName: "Acme",
    name: "general",
    slug: "general",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "public",
    createdByUserId: "user-1",
    createdAt: new Date("2026-09-07T12:00:00.000Z"),
    updatedAt: new Date("2026-09-07T12:00:00.000Z"),
    unreadCount: 4,
    unreadMentionCount: 1,
    starredAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [],
    coworkerMembers: [],
    sokoBotMembers: [],
  };
}

function options() {
  return {
    room: room(),
    messagesPending: false,
    messageLoadFailed: false,
    messages: [{ id: "message-1", content: "Hello" }],
    openThreadParentId: null as string | null,
    threadMessages: [] as { id: string; content: string }[],
    isThreadLoading: false,
  };
}

function threadReadResult() {
  return {
    ok: true as const,
    value: { parentMessageId: "thread-1", lastReadAt: new Date() },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let visibility: DocumentVisibilityState = "visible";

async function showTab(eventName = "visibilitychange") {
  await act(async () => {
    visibility = "visible";
    if (eventName === "focus") window.dispatchEvent(new Event("focus"));
    else document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("useRoomReadAttention", () => {
  beforeEach(() => {
    clearRoomReadOverlays();
    vi.resetAllMocks();
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
    vi.mocked(markOrganizationChatRoomReadAction).mockImplementation(
      async (id) => ({
        ok: true,
        value: { ...room(id), unreadCount: 0, unreadMentionCount: 0 },
      }),
    );
    vi.mocked(markThreadReadAction).mockResolvedValue(threadReadResult());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["visibilitychange", "focus"])(
    "reads a hidden mount on %s without a changed message ID",
    async (eventName) => {
      visibility = "hidden";
      renderHook(() => useRoomReadAttention(options()));
      expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
      await showTab(eventName);
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
      await showTab(eventName);
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    },
  );

  it("defers hidden room messages until visibility returns", async () => {
    const { rerender } = renderHook(useRoomReadAttention, {
      initialProps: options(),
    });
    await act(async () => {});
    vi.mocked(markOrganizationChatRoomReadAction).mockClear();
    visibility = "hidden";
    rerender({
      ...options(),
      messages: [{ id: "message-2", content: "New message" }],
    });
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
    await showTab();
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
  });

  it("defers a final answer with the same message ID until visible", async () => {
    const { rerender } = renderHook(useRoomReadAttention, {
      initialProps: options(),
    });
    await act(async () => {});
    vi.mocked(markOrganizationChatRoomReadAction).mockClear();
    visibility = "hidden";
    rerender({
      ...options(),
      messages: [{ id: "message-1", content: "Final answer" }],
    });
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
    await showTab();
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
  });

  it.each(["messages", "threadMessages"] as const)(
    "reads an earlier completed answer in %s, deferring it while hidden",
    async (field) => {
      const props = {
        ...options(),
        openThreadParentId: field === "threadMessages" ? "thread-1" : null,
        [field]: [
          { id: "earlier", content: "" },
          { id: "newest", content: "Later question" },
        ],
      };
      const { rerender } = renderHook(useRoomReadAttention, {
        initialProps: props,
      });
      await act(async () => {});
      vi.mocked(markOrganizationChatRoomReadAction).mockClear();
      const completed = {
        ...props,
        [field]: [
          { id: "earlier", content: "First answer" },
          { id: "newest", content: "Later question" },
        ],
      };
      rerender(completed);
      await act(async () => {});
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
      vi.mocked(markOrganizationChatRoomReadAction).mockClear();
      visibility = "hidden";
      rerender({
        ...completed,
        [field]: [
          { id: "earlier", content: "Another completed answer" },
          { id: "newest", content: "Later question" },
        ],
      });
      expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
      await showTab();
      expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["messagesPending", "messageLoadFailed"] as const)(
    "does not read on visibility or focus while %s",
    async (field) => {
      const props = { ...options(), [field]: true };
      const { rerender } = renderHook(useRoomReadAttention, {
        initialProps: props,
      });
      await showTab();
      await showTab("focus");
      expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
      rerender({ ...props, [field]: false });
      await waitFor(() =>
        expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1),
      );
    },
  );

  it("looks at hidden thread content before resyncing room attention when visible", async () => {
    visibility = "hidden";
    const props = {
      ...options(),
      openThreadParentId: "thread-1",
      threadMessages: [{ id: "reply-1", content: "Reply" }],
    };
    renderHook(() => useRoomReadAttention(props));
    expect(markThreadReadAction).not.toHaveBeenCalled();
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
    await showTab();
    expect(markThreadReadAction).toHaveBeenCalledWith("room-1", "thread-1");
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(markThreadReadAction).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(markOrganizationChatRoomReadAction).mock.invocationCallOrder[0],
    );
  });

  it("defers the explicit thread-open path while hidden and loading", async () => {
    visibility = "hidden";
    const props = {
      ...options(),
      openThreadParentId: "thread-1",
      isThreadLoading: true,
    };
    const { result, rerender } = renderHook(useRoomReadAttention, {
      initialProps: props,
    });
    await act(async () => {
      expect(await result.current.markThreadRead("room-1", "thread-1")).toBe(
        false,
      );
    });
    rerender({ ...props, isThreadLoading: false });
    expect(markThreadReadAction).not.toHaveBeenCalled();
    await showTab();
    expect(markThreadReadAction).toHaveBeenCalledTimes(1);
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
  });

  it("does not start a room write if the tab hides during a thread write", async () => {
    const pending =
      deferred<Awaited<ReturnType<typeof markThreadReadAction>>>();
    vi.mocked(markThreadReadAction).mockReturnValueOnce(pending.promise);
    renderHook(() =>
      useRoomReadAttention({ ...options(), openThreadParentId: "thread-1" }),
    );
    expect(markThreadReadAction).toHaveBeenCalledTimes(1);
    visibility = "hidden";
    await act(async () => pending.resolve(threadReadResult()));
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
    await showTab();
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
  });

  it("retries a failed thread look on focus without losing remaining thread unread", async () => {
    vi.mocked(markThreadReadAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "failed" },
    });
    vi.mocked(markOrganizationChatRoomReadAction).mockResolvedValue({
      ok: true,
      value: { ...room(), unreadCount: 3, unreadMentionCount: 0 },
    });
    renderHook(() =>
      useRoomReadAttention({ ...options(), openThreadParentId: "thread-1" }),
    );
    await act(async () => {});
    expect(applyRoomReadOverlays([room()])[0].unreadCount).toBe(3);
    await showTab("focus");
    expect(markThreadReadAction).toHaveBeenCalledTimes(2);
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(2);
  });

  it("does not resync for an old message after a newer thread look completed", async () => {
    const pending =
      deferred<Awaited<ReturnType<typeof markThreadReadAction>>>();
    vi.mocked(markThreadReadAction).mockReturnValueOnce(pending.promise);
    const props = { ...options(), openThreadParentId: "thread-1" };
    const { rerender } = renderHook(useRoomReadAttention, {
      initialProps: props,
    });
    rerender({
      ...props,
      threadMessages: [{ id: "reply-2", content: "Reply" }],
    });
    await act(async () => {});
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(threadReadResult()));
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
  });

  it("does not start an old room write after navigation during thread look", async () => {
    const pending =
      deferred<Awaited<ReturnType<typeof markThreadReadAction>>>();
    vi.mocked(markThreadReadAction).mockReturnValueOnce(pending.promise);
    const { rerender } = renderHook(useRoomReadAttention, {
      initialProps: {
        ...options(),
        openThreadParentId: "thread-1" as string | null,
      },
    });
    rerender({ ...options(), room: room("room-2") });
    await act(async () => pending.resolve(threadReadResult()));
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledTimes(1);
    expect(markOrganizationChatRoomReadAction).toHaveBeenCalledWith("room-2");
  });

  it("does not resync a closed thread when its opening read resolves", async () => {
    const pending =
      deferred<Awaited<ReturnType<typeof markThreadReadAction>>>();
    vi.mocked(markThreadReadAction).mockReturnValueOnce(pending.promise);
    const props = {
      ...options(),
      openThreadParentId: "thread-1" as string | null,
      isThreadLoading: true,
    };
    const { result, rerender } = renderHook(useRoomReadAttention, {
      initialProps: props,
    });
    let completion!: Promise<boolean>;
    act(() => {
      completion = result.current.markThreadRead("room-1", "thread-1");
    });
    rerender({ ...props, openThreadParentId: null });
    await act(async () => {
      pending.resolve(threadReadResult());
      await completion;
    });
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
  });

  it("defers post-thread resync while hidden and retains leftover thread unread", async () => {
    const { result } = renderHook(() => useRoomReadAttention(options()));
    await act(async () => {});
    vi.mocked(markOrganizationChatRoomReadAction).mockClear();
    vi.mocked(markOrganizationChatRoomReadAction).mockResolvedValue({
      ok: true,
      value: { ...room(), unreadCount: 3, unreadMentionCount: 0 },
    });
    visibility = "hidden";
    await act(async () =>
      result.current.syncRoomAttentionAfterThreadLook("room-1"),
    );
    expect(markOrganizationChatRoomReadAction).not.toHaveBeenCalled();
    await showTab();
    expect(applyRoomReadOverlays([room()])[0].unreadCount).toBe(3);
  });

  it("does not let an older failed request replace a newer successful read", async () => {
    const pending =
      deferred<
        Awaited<ReturnType<typeof markOrganizationChatRoomReadAction>>
      >();
    vi.mocked(markOrganizationChatRoomReadAction).mockReturnValueOnce(
      pending.promise,
    );
    const { rerender } = renderHook(useRoomReadAttention, {
      initialProps: options(),
    });
    vi.mocked(markOrganizationChatRoomReadAction).mockResolvedValue({
      ok: true,
      value: { ...room(), unreadCount: 2, unreadMentionCount: 0 },
    });
    rerender({
      ...options(),
      messages: [{ id: "message-2", content: "New message" }],
    });
    await act(async () => {});
    await act(async () =>
      pending.resolve({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "failed" },
      }),
    );
    expect(applyRoomReadOverlays([room()])[0].unreadCount).toBe(2);
  });

  it("restores prior attention after rejection even after unmount", async () => {
    const pending =
      deferred<
        Awaited<ReturnType<typeof markOrganizationChatRoomReadAction>>
      >();
    vi.mocked(markOrganizationChatRoomReadAction).mockReturnValueOnce(
      pending.promise,
    );
    const dispatch = vi.spyOn(window, "dispatchEvent");
    const { unmount } = renderHook(() => useRoomReadAttention(options()));
    expect(applyRoomReadOverlays([room()])[0].unreadCount).toBe(0);
    unmount();
    await act(async () =>
      pending.resolve({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "failed" },
      }),
    );
    expect(dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "organization-chat-room-read",
        detail: expect.objectContaining({
          room: expect.objectContaining({ unreadCount: 4 }),
        }),
      }),
    );
    expect(applyRoomReadOverlays([room()])[0].unreadCount).toBe(4);
  });
});
