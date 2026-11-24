import type { ChatRoom } from "@sokosumi/core-client";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SidebarChatListDeferred } from "@/app/components/private-sidebar-cache";

import { useSidebarChatListDeferred } from "./use-sidebar-chat-list-deferred";

const archivedRooms = [{ id: "room-archived" }] as ChatRoom[];

function createDeferred() {
  return Promise.withResolvers<SidebarChatListDeferred>();
}

describe("useSidebarChatListDeferred", () => {
  it("starts null while pending and updates when the promise resolves", async () => {
    const pending = createDeferred();
    const { result } = renderHook(() =>
      useSidebarChatListDeferred(pending.promise),
    );

    expect(result.current).toBeNull();

    await act(async () => {
      pending.resolve({ archivedRooms, isOrgOwnerOrAdmin: true });
    });

    expect(result.current).toEqual({
      archivedRooms,
      isOrgOwnerOrAdmin: true,
    });
  });

  it("remembers a settled answer per promise for subsequent mounts", async () => {
    const pending = createDeferred();
    const first = renderHook(() => useSidebarChatListDeferred(pending.promise));

    await act(async () => {
      pending.resolve({ archivedRooms, isOrgOwnerOrAdmin: true });
    });
    first.unmount();

    const remount = renderHook(() =>
      useSidebarChatListDeferred(pending.promise),
    );
    expect(remount.result.current).toEqual({
      archivedRooms,
      isOrgOwnerOrAdmin: true,
    });
  });

  it("keeps the prior answer while refreshed and ignores a late answer for a replaced promise", async () => {
    const first = createDeferred();
    const { result, rerender } = renderHook(
      ({ deferred }: { deferred: Promise<SidebarChatListDeferred> }) =>
        useSidebarChatListDeferred(deferred),
      { initialProps: { deferred: first.promise } },
    );

    await act(async () => {
      first.resolve({ archivedRooms, isOrgOwnerOrAdmin: true });
    });
    expect(result.current).toEqual({ archivedRooms, isOrgOwnerOrAdmin: true });

    const second = createDeferred();
    rerender({ deferred: second.promise });
    expect(result.current).toEqual({ archivedRooms, isOrgOwnerOrAdmin: true });

    const third = createDeferred();
    rerender({ deferred: third.promise });
    const newer = [{ id: "room-newer" }] as ChatRoom[];
    await act(async () => {
      third.resolve({ archivedRooms: newer, isOrgOwnerOrAdmin: true });
    });
    await act(async () => {
      second.resolve({ archivedRooms: [], isOrgOwnerOrAdmin: false });
    });

    expect(result.current).toEqual({
      archivedRooms: newer,
      isOrgOwnerOrAdmin: true,
    });
  });

  it("keeps existing state and swallows rejections without unhandledRejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const first = createDeferred();
      const { result, rerender } = renderHook(
        ({ deferred }: { deferred: Promise<SidebarChatListDeferred> }) =>
          useSidebarChatListDeferred(deferred),
        { initialProps: { deferred: first.promise } },
      );

      await act(async () => {
        first.resolve({ archivedRooms, isOrgOwnerOrAdmin: true });
      });

      const failed = createDeferred();
      rerender({ deferred: failed.promise });
      await act(async () => {
        failed.reject(new Error("connection closed"));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(result.current).toEqual({
        archivedRooms,
        isOrgOwnerOrAdmin: true,
      });
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
  });
});
