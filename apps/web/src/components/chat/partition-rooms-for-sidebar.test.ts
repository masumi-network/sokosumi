import { describe, expect, it } from "vitest";

import type { ChatRoom } from "@/lib/clients/generated/core";

import { partitionRoomsForSidebar } from "./partition-rooms-for-sidebar";

function makeRoom(
  overrides: Partial<ChatRoom> & Pick<ChatRoom, "id" | "kind" | "myAccess">,
): ChatRoom {
  return {
    organizationId: "org_1",
    organizationName: "Acme",
    name: overrides.id,
    slug: overrides.kind === "channel" ? overrides.id : null,
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
    orchestratorMembers: overrides.orchestratorMembers ?? [],
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
      namedChannels: [],
      directMessages: [],
      externalJoined: [],
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
});
