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

  it("orders pinned rooms by pinnedAt ascending", () => {
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
    ).toEqual(["earlier", "later"]);
  });

  it("sorts unmuted rooms before muted rooms", () => {
    const muted = {
      id: "muted-newer",
      updatedAt: "2026-08-03T18:00:00.000Z",
      mutedAt: "2026-08-03T12:00:00.000Z",
    };
    const unmuted = {
      id: "unmuted-older",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mutedAt: null,
    };

    expect(
      [muted, unmuted].sort(compareChatRoomsByRecentActivity).map((r) => r.id),
    ).toEqual(["unmuted-older", "muted-newer"]);
  });

  it("keeps pin order among unmuted rooms and activity among muted", () => {
    const mutedNewer = {
      id: "muted-newer",
      updatedAt: "2026-08-03T20:00:00.000Z",
      mutedAt: "2026-08-03T12:00:00.000Z",
      pinnedAt: null,
    };
    const mutedOlder = {
      id: "muted-older",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mutedAt: "2026-08-03T11:00:00.000Z",
      pinnedAt: null,
    };
    const unmutedUnpinned = {
      id: "unmuted-unpinned",
      updatedAt: "2026-08-03T19:00:00.000Z",
      mutedAt: null,
      pinnedAt: null,
    };
    const unmutedPinned = {
      id: "unmuted-pinned",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mutedAt: null,
      pinnedAt: "2026-08-03T09:00:00.000Z",
    };

    expect(
      [mutedNewer, unmutedUnpinned, mutedOlder, unmutedPinned]
        .sort(compareChatRoomsByRecentActivity)
        .map((r) => r.id),
    ).toEqual([
      "unmuted-pinned",
      "unmuted-unpinned",
      "muted-newer",
      "muted-older",
    ]);
  });

  it("keeps private below public in pinned, normal, and muted buckets", () => {
    const mutedPrivate = {
      id: "muted-private",
      updatedAt: "2026-08-03T23:00:00.000Z",
      mutedAt: "2026-08-03T12:00:00.000Z",
      pinnedAt: null,
      discoverability: "private" as const,
    };
    const mutedPublic = {
      id: "muted-public",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mutedAt: "2026-08-03T11:00:00.000Z",
      pinnedAt: null,
      discoverability: "public" as const,
    };
    const normalPrivate = {
      id: "normal-private",
      updatedAt: "2026-08-03T22:00:00.000Z",
      mutedAt: null,
      pinnedAt: null,
      discoverability: "private" as const,
    };
    const normalPublic = {
      id: "normal-public",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mutedAt: null,
      pinnedAt: null,
      discoverability: "public" as const,
    };
    const pinnedPrivate = {
      id: "pinned-private",
      updatedAt: "2026-08-03T21:00:00.000Z",
      mutedAt: null,
      pinnedAt: "2026-08-03T08:00:00.000Z",
      discoverability: "private" as const,
    };
    const pinnedPublic = {
      id: "pinned-public",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mutedAt: null,
      pinnedAt: "2026-08-03T10:00:00.000Z",
      discoverability: "public" as const,
    };

    expect(
      [
        mutedPrivate,
        normalPrivate,
        mutedPublic,
        pinnedPrivate,
        normalPublic,
        pinnedPublic,
      ]
        .sort(compareChatRoomsByRecentActivity)
        .map((r) => r.id),
    ).toEqual([
      "pinned-public",
      "pinned-private",
      "normal-public",
      "normal-private",
      "muted-public",
      "muted-private",
    ]);
  });
});
