import type { ChatRoom } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import { partitionRoomsForSidebar } from "./partition-rooms-for-sidebar";

function makeRoom(
  overrides: Partial<ChatRoom> & Pick<ChatRoom, "id" | "kind" | "myAccess">,
): ChatRoom {
  return {
    organizationId: "org_1",
    organizationName: "Acme",
    name: overrides.id,
    slug: overrides.kind === "channel" ? overrides.id : null,
    isSelfDirect: false,
    isGroupDirect: false,
    isReadOnly: false,
    formerUserMembers: [],
    groupName: null,
    directKey: null,
    topic: null,
    discoverability: overrides.kind === "channel" ? "public" : null,
    createdByUserId: "user_1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    starredAt: null,
    mutedAt: null,
    markedUnread: false,
    userMembers: [],
    coworkerMembers: [],
    ...overrides,
    sokoBotMembers: overrides.sokoBotMembers ?? [],
  };
}

describe("partitionRoomsForSidebar", () => {
  it("puts guest rooms only under externalJoined, not channels", () => {
    const guest = makeRoom({
      id: "guest-room",
      kind: "channel",
      myAccess: "guest",
      discoverability: "external",
      organizationName: "Host Co",
      name: "Partners",
    });
    const channel = makeRoom({
      id: "host-channel",
      kind: "channel",
      myAccess: "member",
      name: "General",
    });
    const direct = makeRoom({
      id: "dm-1",
      kind: "direct",
      myAccess: "member",
      discoverability: null,
    });

    const result = partitionRoomsForSidebar([guest, channel, direct]);

    expect(result.externalJoined.map((r) => r.id)).toEqual(["guest-room"]);
    expect(result.namedChannels.map((r) => r.id)).toEqual(["host-channel"]);
    expect(result.directMessages.map((r) => r.id)).toEqual(["dm-1"]);
  });

  it("puts host-member external channels under External, not Channels", () => {
    const hostExternal = makeRoom({
      id: "ext-member",
      kind: "channel",
      myAccess: "member",
      discoverability: "external",
      name: "External host view",
    });
    const publicChannel = makeRoom({
      id: "public-1",
      kind: "channel",
      myAccess: "member",
      discoverability: "public",
      name: "General",
    });

    const result = partitionRoomsForSidebar([hostExternal, publicChannel]);

    expect(result.externalJoined.map((r) => r.id)).toEqual(["ext-member"]);
    expect(result.namedChannels.map((r) => r.id)).toEqual(["public-1"]);
  });

  it("puts matched channels under External, not Channels", () => {
    const matched = makeRoom({
      id: "matched-1",
      kind: "channel",
      myAccess: "member",
      discoverability: "matched",
      organizationId: null,
      organizationName: null,
      name: "Matched room",
    });
    const publicChannel = makeRoom({
      id: "public-1",
      kind: "channel",
      myAccess: "member",
      discoverability: "public",
      name: "General",
    });

    const result = partitionRoomsForSidebar([matched, publicChannel]);

    expect(result.externalJoined.map((r) => r.id)).toEqual(["matched-1"]);
    expect(result.namedChannels.map((r) => r.id)).toEqual(["public-1"]);
  });

  it("puts personal human Directs under Direct Messages even when the peer is not an org teammate", () => {
    const personal = makeRoom({
      id: "personal-dm",
      kind: "direct",
      myAccess: "member",
      discoverability: null,
      organizationId: null,
      organizationName: null,
      peerInActiveOrganization: false,
    });

    const result = partitionRoomsForSidebar([personal]);

    expect(result.directMessages.map((r) => r.id)).toEqual(["personal-dm"]);
    expect(result.externalJoined).toEqual([]);
  });

  it("puts personal human Directs under Direct Messages when the peer is an org teammate", () => {
    const personal = makeRoom({
      id: "teammate-personal-dm",
      kind: "direct",
      myAccess: "member",
      discoverability: null,
      organizationId: null,
      organizationName: null,
      peerInActiveOrganization: true,
    });

    const result = partitionRoomsForSidebar([personal]);

    expect(result.directMessages.map((r) => r.id)).toEqual([
      "teammate-personal-dm",
    ]);
    expect(result.externalJoined).toEqual([]);
  });

  it("keeps personal coworker Directs under Direct Messages", () => {
    const coworkerDm = makeRoom({
      id: "coworker-dm",
      kind: "direct",
      myAccess: "member",
      discoverability: null,
      organizationId: null,
      organizationName: null,
      peerInActiveOrganization: false,
      coworkerMembers: [
        {
          id: "cow_1",
          name: "Elena",
          slug: "elena",
          caption: null,
          image: null,
          presence: "online",
        },
      ],
    });

    const result = partitionRoomsForSidebar([coworkerDm]);

    expect(result.directMessages.map((r) => r.id)).toEqual(["coworker-dm"]);
    expect(result.externalJoined).toEqual([]);
  });

  it("returns empty buckets for empty input", () => {
    expect(partitionRoomsForSidebar([])).toEqual({
      pinned: [],
      namedChannels: [],
      directMessages: [],
      externalJoined: [],
      hasOwnChannel: false,
      hasDirect: false,
    });
  });

  it("sorts each bucket by recent activity", () => {
    const olderGuest = makeRoom({
      id: "guest-old",
      kind: "channel",
      myAccess: "guest",
      discoverability: "external",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const newerGuest = makeRoom({
      id: "guest-new",
      kind: "channel",
      myAccess: "guest",
      discoverability: "external",
      updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    });

    const result = partitionRoomsForSidebar([olderGuest, newerGuest]);

    expect(result.externalJoined.map((r) => r.id)).toEqual([
      "guest-new",
      "guest-old",
    ]);
  });

  it("lists pinned rooms of every kind under pinned only, oldest starredAt first", () => {
    const pinnedDirect = makeRoom({
      id: "pinned-dm",
      kind: "direct",
      myAccess: "member",
      starredAt: new Date("2026-08-02T12:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    const pinnedChannel = makeRoom({
      id: "pinned-channel",
      kind: "channel",
      myAccess: "member",
      starredAt: new Date("2026-08-02T10:00:00.000Z"),
    });
    const pinnedGuest = makeRoom({
      id: "pinned-guest",
      kind: "channel",
      myAccess: "guest",
      discoverability: "external",
      starredAt: new Date("2026-08-02T11:00:00.000Z"),
    });
    const channel = makeRoom({
      id: "channel",
      kind: "channel",
      myAccess: "member",
    });

    const result = partitionRoomsForSidebar([
      pinnedDirect,
      channel,
      pinnedGuest,
      pinnedChannel,
    ]);

    expect(result.pinned.map((r) => r.id)).toEqual([
      "pinned-channel",
      "pinned-guest",
      "pinned-dm",
    ]);
    expect(result.namedChannels.map((r) => r.id)).toEqual(["channel"]);
    expect(result.directMessages).toEqual([]);
    expect(result.externalJoined).toEqual([]);
  });
});

describe("partitionRoomsForSidebar empty-section hints", () => {
  it("knows the reader has a channel when theirs is External or pinned", () => {
    const external = makeRoom({
      id: "launch",
      kind: "channel",
      myAccess: "member",
      discoverability: "external",
    });
    const pinned = makeRoom({
      id: "general",
      kind: "channel",
      myAccess: "member",
      starredAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    expect(partitionRoomsForSidebar([external]).hasOwnChannel).toBe(true);
    expect(partitionRoomsForSidebar([pinned]).hasOwnChannel).toBe(true);
  });

  it("does not count another organization's channel the reader is a guest in", () => {
    const guest = makeRoom({
      id: "partners",
      kind: "channel",
      myAccess: "guest",
      discoverability: "external",
    });

    expect(partitionRoomsForSidebar([guest]).hasOwnChannel).toBe(false);
  });

  it("knows the reader has a direct message when it is pinned", () => {
    const pinnedDirect = makeRoom({
      id: "dm-1",
      kind: "direct",
      myAccess: "member",
      discoverability: null,
      starredAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    const result = partitionRoomsForSidebar([pinnedDirect]);
    expect(result.directMessages).toHaveLength(0);
    expect(result.hasDirect).toBe(true);
  });
});
