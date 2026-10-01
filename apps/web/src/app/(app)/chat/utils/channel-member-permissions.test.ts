import type { ChatRoom } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import type { ChatParticipantHoverProfile } from "@/app/chat/components/room-helpers";
import {
  canLeaveChannel,
  canManageChannelMembers,
  canManageChannelSettings,
  canRemoveChannelMember,
} from "./channel-member-permissions";

const ME = "user-me";

function user(
  id: string,
  access: "member" | "guest",
): ChatRoom["userMembers"][number] {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    image: null,
    presence: "offline",
    access,
  };
}

function room(overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id: "room-1",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "general",
    slug: "general",
    kind: "channel",
    isSelfDirect: false,
    isGroupDirect: false,
    groupName: null,
    directKey: null,
    topic: null,
    discoverability: "external",
    createdByUserId: ME,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    starredAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [
      user(ME, "member"),
      user("user-host", "member"),
      user("user-guest", "guest"),
    ],
    coworkerMembers: [],
    sokoBotMembers: [
      {
        id: "bot-mine",
        name: "Mine",
        caption: null,
        image: null,
        avatarSeed: null,
        ownerUserId: ME,
        presence: "online",
      },
      {
        id: "bot-theirs",
        name: "Theirs",
        caption: null,
        image: null,
        avatarSeed: null,
        ownerUserId: "user-host",
        presence: "online",
      },
    ],
    ...overrides,
  };
}

function human(id: string): ChatParticipantHoverProfile {
  return {
    kind: "human",
    id,
    name: id,
    email: `${id}@example.com`,
    image: null,
    presence: "offline",
  };
}

const coworker: ChatParticipantHoverProfile = {
  kind: "coworker",
  id: "cow-1",
  name: "Soupie",
  slug: "soupie",
  caption: null,
  image: null,
  presence: "online",
};

function sokoBot(id: string): ChatParticipantHoverProfile {
  return {
    kind: "sokoBot",
    id,
    name: id,
    caption: null,
    image: null,
    avatarSeed: null,
    presence: "online",
  };
}

const member = { currentUserId: ME, isOrgOwnerOrAdmin: false };
const admin = { currentUserId: ME, isOrgOwnerOrAdmin: true };

describe("canManageChannelMembers", () => {
  it("lets a host member of a Channel manage its members", () => {
    expect(canManageChannelMembers(room())).toBe(true);
  });

  it.each([
    ["a guest", { myAccess: "guest" as const }],
    ["a matched channel", { discoverability: "matched" as const }],
    ["a channel with no organization", { organizationId: null }],
    ["a Direct", { kind: "direct" as const, discoverability: null }],
  ])("keeps %s read-only", (_label, overrides) => {
    expect(canManageChannelMembers(room(overrides))).toBe(false);
  });
});

describe("canManageChannelSettings", () => {
  it("is for an owner or admin who is a host member", () => {
    expect(canManageChannelSettings(room(), true)).toBe(true);
    expect(canManageChannelSettings(room(), false)).toBe(false);
    expect(canManageChannelSettings(room({ myAccess: "guest" }), true)).toBe(
      false,
    );
  });
});

describe("canLeaveChannel", () => {
  it("keeps the last host member in a host-org channel", () => {
    expect(canLeaveChannel(room())).toBe(true);
    expect(canLeaveChannel(room({ userMembers: [user(ME, "member")] }))).toBe(
      false,
    );
  });

  it("lets a guest or a matched member leave", () => {
    expect(
      canLeaveChannel(
        room({ myAccess: "guest", userMembers: [user(ME, "guest")] }),
      ),
    ).toBe(true);
    expect(
      canLeaveChannel(
        room({ discoverability: "matched", userMembers: [user(ME, "member")] }),
      ),
    ).toBe(true);
  });
});

describe("canRemoveChannelMember", () => {
  it("lets any host member remove guests and Coworkers", () => {
    expect(canRemoveChannelMember(room(), human("user-guest"), member)).toBe(
      true,
    );
    expect(canRemoveChannelMember(room(), coworker, member)).toBe(true);
  });

  it("lets only an owner or admin remove a host member", () => {
    expect(canRemoveChannelMember(room(), human("user-host"), member)).toBe(
      false,
    );
    expect(canRemoveChannelMember(room(), human("user-host"), admin)).toBe(
      true,
    );
  });

  it("never offers to remove yourself", () => {
    expect(canRemoveChannelMember(room(), human(ME), admin)).toBe(false);
  });

  it("lets only its owner remove a Soko Bot", () => {
    expect(canRemoveChannelMember(room(), sokoBot("bot-mine"), member)).toBe(
      true,
    );
    expect(canRemoveChannelMember(room(), sokoBot("bot-theirs"), admin)).toBe(
      false,
    );
  });

  it("removes nobody from a read-only channel", () => {
    expect(
      canRemoveChannelMember(
        room({ myAccess: "guest" }),
        human("user-guest"),
        admin,
      ),
    ).toBe(false);
    expect(
      canRemoveChannelMember(
        room({ discoverability: "matched" }),
        coworker,
        admin,
      ),
    ).toBe(false);
  });
});
