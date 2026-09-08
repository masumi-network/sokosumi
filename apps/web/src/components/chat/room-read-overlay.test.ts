import { afterEach, describe, expect, it } from "vitest";

import {
  applyRoomReadOverlays,
  beginRoomAttentionChange,
  beginRoomAttentionRefresh,
  clearRoomReadOverlays,
  forgetRoomRead,
  reconcileRoomAttention,
  rememberRoomRead,
  settleRoomAttentionChange,
} from "./room-read-overlay";

function room(overrides: {
  id?: string;
  updatedAt?: string;
  unreadCount?: number;
  unreadMentionCount?: number;
  markedUnread?: boolean;
}) {
  return {
    id: overrides.id ?? "room-1",
    updatedAt: overrides.updatedAt ?? "2026-08-01T12:00:00.000Z",
    unreadCount: overrides.unreadCount ?? 0,
    unreadMentionCount: overrides.unreadMentionCount ?? 0,
    markedUnread: overrides.markedUnread ?? false,
  };
}

afterEach(() => {
  clearRoomReadOverlays();
});

describe("room-read-overlay", () => {
  it("keeps a room cleared after remount with stale unread props (mobile sheet)", () => {
    // Mark-read succeeded while the sheet (and list) was unmounted.
    rememberRoomRead(
      room({
        updatedAt: "2026-08-01T12:00:00.000Z",
        unreadCount: 0,
      }),
    );

    // Remount hydrates from RSC props that still carry pre-read unread.
    const remounted = applyRoomReadOverlays([
      room({
        updatedAt: "2026-08-01T12:00:00.000Z",
        unreadCount: 4,
        unreadMentionCount: 1,
        markedUnread: true,
      }),
    ]);

    expect(remounted[0]).toMatchObject({
      unreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
    });
  });

  it("drops the overlay when the server reports newer room activity", () => {
    rememberRoomRead(
      room({
        updatedAt: "2026-08-01T12:00:00.000Z",
        unreadCount: 0,
      }),
    );

    const withNewMessages = applyRoomReadOverlays([
      room({
        updatedAt: "2026-08-01T12:05:00.000Z",
        unreadCount: 2,
        unreadMentionCount: 1,
      }),
    ]);

    expect(withNewMessages[0]).toMatchObject({
      unreadCount: 2,
      unreadMentionCount: 1,
    });
  });

  it("forgets the overlay when the user marks the room unread again", () => {
    rememberRoomRead(room({ unreadCount: 0 }));
    forgetRoomRead("room-1");

    const rows = applyRoomReadOverlays([
      room({ unreadCount: 0, markedUnread: true }),
    ]);

    expect(rows[0]?.markedUnread).toBe(true);
  });

  it("keeps leftover thread unread on remount, not the stale full count", () => {
    rememberRoomRead(
      room({
        unreadCount: 2,
        unreadMentionCount: 0,
        markedUnread: false,
      }),
    );

    const remounted = applyRoomReadOverlays([
      room({
        unreadCount: 10,
        unreadMentionCount: 1,
        markedUnread: true,
      }),
    ]);

    expect(remounted[0]).toMatchObject({
      unreadCount: 2,
      unreadMentionCount: 0,
      markedUnread: false,
    });
  });

  it("does not let a stale fully-clear row wipe leftover thread unread", () => {
    rememberRoomRead(
      room({
        unreadCount: 2,
        unreadMentionCount: 0,
        markedUnread: false,
      }),
    );

    const staleFullyClear = applyRoomReadOverlays([
      room({
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: false,
      }),
    ]);

    expect(staleFullyClear[0]).toMatchObject({
      unreadCount: 2,
      unreadMentionCount: 0,
      markedUnread: false,
    });
  });

  it("keeps a fully-clear overlay after a matching row so a later stale fetch stays read", () => {
    rememberRoomRead(
      room({
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: false,
      }),
    );

    const matchingClear = applyRoomReadOverlays([
      room({
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: false,
      }),
    ]);
    expect(matchingClear[0]).toMatchObject({ unreadCount: 0 });

    const staleUnread = applyRoomReadOverlays([
      room({
        unreadCount: 4,
        unreadMentionCount: 1,
        markedUnread: false,
      }),
    ]);
    expect(staleUnread[0]).toMatchObject({
      unreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
    });
  });

  it("keeps leftover overlay after a matching poll so a later stale fetch still overlays", () => {
    rememberRoomRead(
      room({
        unreadCount: 2,
        unreadMentionCount: 0,
        markedUnread: false,
      }),
    );

    const caughtUp = applyRoomReadOverlays([
      room({
        unreadCount: 2,
        unreadMentionCount: 0,
        markedUnread: false,
      }),
    ]);
    expect(caughtUp[0]).toMatchObject({ unreadCount: 2 });

    const staleAgain = applyRoomReadOverlays([
      room({
        unreadCount: 10,
        unreadMentionCount: 1,
        markedUnread: false,
      }),
    ]);
    expect(staleAgain[0]).toMatchObject({
      unreadCount: 2,
      unreadMentionCount: 0,
      markedUnread: false,
    });
  });

  it("optimistically clears stale remount chrome before the server row returns", () => {
    rememberRoomRead(
      room({
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: false,
      }),
    );

    const remounted = applyRoomReadOverlays([
      room({
        unreadCount: 4,
        unreadMentionCount: 1,
        markedUnread: true,
      }),
    ]);

    expect(remounted[0]).toMatchObject({
      unreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
    });
  });

  it("restores stale unread after a failed mark-read forgets the overlay", () => {
    rememberRoomRead(
      room({
        unreadCount: 0,
        unreadMentionCount: 0,
        markedUnread: false,
      }),
    );
    forgetRoomRead("room-1");

    const remounted = applyRoomReadOverlays([
      room({
        unreadCount: 4,
        unreadMentionCount: 1,
        markedUnread: false,
      }),
    ]);

    expect(remounted[0]).toMatchObject({
      unreadCount: 4,
      unreadMentionCount: 1,
    });
  });
});

describe("authoritative room attention", () => {
  it("accepts Mark unread and Thread Look without new room activity", () => {
    rememberRoomRead(room({ unreadCount: 2 }));
    const request = beginRoomAttentionRefresh();
    const fresh = room({ unreadCount: 0, markedUnread: true });

    expect(reconcileRoomAttention([fresh], request)).toEqual([fresh]);
    expect(applyRoomReadOverlays([room({ unreadCount: 5 })])[0]).toMatchObject({
      unreadCount: 0,
      markedUnread: true,
    });
  });

  it("keeps a pending read when a fetch starts after the optimistic clear", () => {
    const token = beginRoomAttentionChange(room({ unreadCount: 0 }));
    const request = beginRoomAttentionRefresh();
    // A second listener sees the same optimistic event.
    rememberRoomRead(room({ unreadCount: 0 }));

    expect(
      reconcileRoomAttention([room({ unreadCount: 5 })], request)[0],
    ).toMatchObject({ unreadCount: 0 });
    expect(
      settleRoomAttentionChange("room-1", token, room({ unreadCount: 2 })),
    ).toBe(true);
    expect(applyRoomReadOverlays([room({ unreadCount: 5 })])[0]).toMatchObject({
      unreadCount: 2,
    });
  });

  it("protects a read that starts and settles during an older fetch", () => {
    const request = beginRoomAttentionRefresh();
    const token = beginRoomAttentionChange(room({}));
    settleRoomAttentionChange("room-1", token, room({ unreadCount: 2 }));

    expect(
      reconcileRoomAttention([room({ unreadCount: 5 })], request)[0],
    ).toMatchObject({ unreadCount: 2 });
    const laterRequest = beginRoomAttentionRefresh();
    expect(
      reconcileRoomAttention([room({ unreadCount: 1 })], laterRequest)[0],
    ).toMatchObject({ unreadCount: 1 });
  });

  it("rejects a superseded read result and permits another room's fetch", () => {
    const oldToken = beginRoomAttentionChange(room({}));
    const token = beginRoomAttentionChange(room({ unreadCount: 2 }));
    expect(settleRoomAttentionChange("room-1", oldToken, room({}))).toBe(false);
    const otherRoom = room({ id: "room-2", unreadCount: 3 });
    expect(
      reconcileRoomAttention([otherRoom], beginRoomAttentionRefresh()),
    ).toEqual([otherRoom]);
    expect(
      settleRoomAttentionChange("room-1", token, room({ unreadCount: 2 })),
    ).toBe(true);
  });

  it("releases failed reads so the next server response can restore unread", () => {
    const token = beginRoomAttentionChange(room({}));
    expect(settleRoomAttentionChange("room-1", token, null)).toBe(true);
    const unread = room({ unreadCount: 5 });
    expect(
      reconcileRoomAttention([unread], beginRoomAttentionRefresh()),
    ).toEqual([unread]);
  });

  it("keeps the latest attention when another consumer finishes an older fetch", () => {
    const olderRequest = beginRoomAttentionRefresh();
    const newerRequest = beginRoomAttentionRefresh();
    reconcileRoomAttention([room({ unreadCount: 1 })], newerRequest);

    expect(reconcileRoomAttention([room({})], olderRequest)[0]).toMatchObject({
      unreadCount: 1,
    });
    expect(applyRoomReadOverlays([room({})])[0]).toMatchObject({
      unreadCount: 1,
    });
  });
});
