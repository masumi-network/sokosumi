import { describe, expect, it } from "vitest";

import {
  compareChatRoomsByRecentActivity,
  comparePinnedChatRooms,
} from "./chat-room-activity-sort";

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

  it("keeps activity order among muted rooms", () => {
    const mutedNewer = {
      id: "muted-newer",
      updatedAt: "2026-08-03T20:00:00.000Z",
      mutedAt: "2026-08-03T12:00:00.000Z",
    };
    const mutedOlder = {
      id: "muted-older",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mutedAt: "2026-08-03T11:00:00.000Z",
    };
    const unmuted = {
      id: "unmuted",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mutedAt: null,
    };

    expect(
      [mutedOlder, mutedNewer, unmuted]
        .sort(compareChatRoomsByRecentActivity)
        .map((r) => r.id),
    ).toEqual(["unmuted", "muted-newer", "muted-older"]);
  });

  it("keeps private below public in normal and muted buckets", () => {
    const mutedPrivate = {
      id: "muted-private",
      updatedAt: "2026-08-03T23:00:00.000Z",
      mutedAt: "2026-08-03T12:00:00.000Z",
      discoverability: "private" as const,
    };
    const mutedPublic = {
      id: "muted-public",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mutedAt: "2026-08-03T11:00:00.000Z",
      discoverability: "public" as const,
    };
    const normalPrivate = {
      id: "normal-private",
      updatedAt: "2026-08-03T22:00:00.000Z",
      mutedAt: null,
      discoverability: "private" as const,
    };
    const normalPublic = {
      id: "normal-public",
      updatedAt: "2026-01-01T00:00:00.000Z",
      mutedAt: null,
      discoverability: "public" as const,
    };

    expect(
      [mutedPrivate, normalPrivate, mutedPublic, normalPublic]
        .sort(compareChatRoomsByRecentActivity)
        .map((r) => r.id),
    ).toEqual([
      "normal-public",
      "normal-private",
      "muted-public",
      "muted-private",
    ]);
  });
});

describe("comparePinnedChatRooms", () => {
  it("orders by starredAt ascending, whatever the activity or visibility", () => {
    const later = { id: "a-later", starredAt: "2026-08-02T12:00:00.000Z" };
    const earlier = {
      id: "z-earlier",
      starredAt: new Date("2026-08-02T10:00:00.000Z"),
    };

    expect(
      [later, earlier].sort(comparePinnedChatRooms).map((r) => r.id),
    ).toEqual(["z-earlier", "a-later"]);
  });

  it("ties equal starredAt by id ascending", () => {
    const stamp = "2026-08-02T10:00:00.000Z";
    expect(
      [
        { id: "room-b", starredAt: stamp },
        { id: "room-a", starredAt: stamp },
      ]
        .sort(comparePinnedChatRooms)
        .map((r) => r.id),
    ).toEqual(["room-a", "room-b"]);
  });
});
