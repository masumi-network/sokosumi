import { describe, expect, it } from "vitest";

import { compareChatRoomsByRecentActivity } from "../chat-room-activity-sort";

describe("compareChatRoomsByRecentActivity", () => {
  it("sorts newer updatedAt first so channels bump like DMs", () => {
    const older = {
      id: "alpha",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const newer = {
      id: "zeta",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };

    // Alphabetical-by-name would put alpha before zeta; activity wins.
    expect(
      [older, newer].sort(compareChatRoomsByRecentActivity).map((r) => r.id),
    ).toEqual(["zeta", "alpha"]);
  });

  it("ties equal updatedAt by id ascending", () => {
    const stamp = "2026-03-15T12:00:00.000Z";
    const a = { id: "room-b", updatedAt: stamp };
    const b = { id: "room-a", updatedAt: stamp };

    expect(
      [a, b].sort(compareChatRoomsByRecentActivity).map((r) => r.id),
    ).toEqual(["room-a", "room-b"]);
  });

  it("accepts ISO string timestamps like ChatRoom DTO", () => {
    const a = {
      id: "a",
      updatedAt: "2026-02-01T10:00:00.000Z",
    };
    const b = {
      id: "b",
      updatedAt: "2026-02-01T11:00:00.000Z",
    };

    expect(compareChatRoomsByRecentActivity(a, b)).toBeGreaterThan(0);
    expect(compareChatRoomsByRecentActivity(b, a)).toBeLessThan(0);
  });

  it("sorts pinned rooms before unpinned rooms", () => {
    const unpinned = {
      id: "newer-unpinned",
      updatedAt: "2026-08-02T18:00:00.000Z",
      pinnedAt: null,
    };
    const pinned = {
      id: "older-pinned",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pinnedAt: "2026-08-02T12:00:00.000Z",
    };

    expect(
      [unpinned, pinned]
        .sort(compareChatRoomsByRecentActivity)
        .map((r) => r.id),
    ).toEqual(["older-pinned", "newer-unpinned"]);
  });

  it("orders pinned rooms by pinnedAt descending", () => {
    const pinnedEarlier = {
      id: "earlier",
      updatedAt: "2026-08-02T18:00:00.000Z",
      pinnedAt: "2026-08-02T10:00:00.000Z",
    };
    const pinnedLater = {
      id: "later",
      updatedAt: "2026-01-01T00:00:00.000Z",
      pinnedAt: "2026-08-02T12:00:00.000Z",
    };

    expect(
      [pinnedEarlier, pinnedLater]
        .sort(compareChatRoomsByRecentActivity)
        .map((r) => r.id),
    ).toEqual(["later", "earlier"]);
  });
});
