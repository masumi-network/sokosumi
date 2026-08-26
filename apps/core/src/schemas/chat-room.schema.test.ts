import { describe, expect, it } from "vitest";

import {
  chatRoomAccessSchema,
  chatRoomDiscoverabilitySchema,
  chatRoomSchema,
  createChatRoomRequestSchema,
  discoverableChatRoomSchema,
} from "./chat-room.schema";
import {
  chatRoomInvitationSchema,
  chatRoomInvitationStatusSchema,
  createChatRoomInvitationRequestSchema,
} from "./chat-room-invitation.schema";

describe("chatRoomDiscoverabilitySchema", () => {
  it("accepts public, private, and external", () => {
    expect(chatRoomDiscoverabilitySchema.parse("public")).toBe("public");
    expect(chatRoomDiscoverabilitySchema.parse("private")).toBe("private");
    expect(chatRoomDiscoverabilitySchema.parse("external")).toBe("external");
  });

  it("rejects unknown values", () => {
    expect(() => chatRoomDiscoverabilitySchema.parse("secret")).toThrow();
  });
});

describe("chatRoomAccessSchema", () => {
  it("accepts member and guest", () => {
    expect(chatRoomAccessSchema.parse("member")).toBe("member");
    expect(chatRoomAccessSchema.parse("guest")).toBe("guest");
  });
});

describe("chatRoomSchema", () => {
  const baseRoom = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    organizationId: "org_123",
    organizationName: "Acme Corp",
    name: "Launch Room",
    slug: "launch-room",
    kind: "channel" as const,
    directKey: null,
    topic: null,
    discoverability: "external" as const,
    createdByUserId: "user_123",
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z",
    unreadCount: 0,
    unreadMentionCount: 0,
    starredAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "guest" as const,
    userMembers: [],
    coworkerMembers: [],
  };

  it("requires myAccess and organizationName", () => {
    const parsed = chatRoomSchema.parse(baseRoom);
    expect(parsed.myAccess).toBe("guest");
    expect(parsed.organizationName).toBe("Acme Corp");
    expect(parsed.discoverability).toBe("external");
  });

  it("allows null organizationName", () => {
    const parsed = chatRoomSchema.parse({
      ...baseRoom,
      organizationName: null,
      myAccess: "member",
      discoverability: "public",
    });
    expect(parsed.organizationName).toBeNull();
  });

  it("defaults peerInActiveOrganization to false", () => {
    const parsed = chatRoomSchema.parse(baseRoom);
    expect(parsed.peerInActiveOrganization).toBe(false);
  });

  it("allows a null slug on Directs", () => {
    const parsed = chatRoomSchema.parse({
      ...baseRoom,
      kind: "direct",
      slug: null,
      discoverability: null,
      directKey: "user_123:user_456",
    });
    expect(parsed.slug).toBeNull();
  });

  it("fails without myAccess", () => {
    const { myAccess: _myAccess, ...without } = baseRoom;
    expect(() => chatRoomSchema.parse(without)).toThrow();
  });
});

describe("discoverableChatRoomSchema", () => {
  const base = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    name: "Launch Room",
    slug: "launch-room",
    topic: null,
    memberCount: 3,
    createdByUserId: "user_123",
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z",
  };

  it("accepts public and external", () => {
    expect(
      discoverableChatRoomSchema.parse({
        ...base,
        discoverability: "public",
      }).discoverability,
    ).toBe("public");
    expect(
      discoverableChatRoomSchema.parse({
        ...base,
        discoverability: "external",
      }).discoverability,
    ).toBe("external");
  });

  it("accepts private for elevated browse listing", () => {
    expect(
      discoverableChatRoomSchema.parse({
        ...base,
        discoverability: "private",
      }).discoverability,
    ).toBe("private");
  });
});

describe("createChatRoomRequestSchema", () => {
  it("accepts external discoverability on channel create", () => {
    const parsed = createChatRoomRequestSchema.parse({
      kind: "channel",
      name: "Client Room",
      discoverability: "external",
    });
    expect(parsed).toMatchObject({
      kind: "channel",
      discoverability: "external",
    });
  });

  it("accepts channel create with a slug and no name", () => {
    const parsed = createChatRoomRequestSchema.parse({
      kind: "channel",
      slug: "team-soko",
    });
    expect(parsed).toMatchObject({
      kind: "channel",
      slug: "team-soko",
    });
  });
});

describe("chat room invitation schemas", () => {
  it("parses create request email", () => {
    expect(
      createChatRoomInvitationRequestSchema.parse({
        email: "  guest@example.com  ",
      }),
    ).toEqual({ email: "guest@example.com" });
  });

  it("parses invitation status enum", () => {
    for (const status of [
      "pending",
      "accepted",
      "revoked",
      "declined",
      "expired",
    ] as const) {
      expect(chatRoomInvitationStatusSchema.parse(status)).toBe(status);
    }
  });

  it("parses invitation DTO", () => {
    const parsed = chatRoomInvitationSchema.parse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      roomId: "550e8400-e29b-41d4-a716-446655440001",
      roomName: "Client Room",
      organizationId: "org_123",
      organizationName: "Acme Corp",
      email: "guest@example.com",
      status: "pending",
      inviter: { id: "user_123", name: "Jane Doe" },
      expiresAt: "2026-08-12T12:00:00.000Z",
      createdAt: "2026-08-05T12:00:00.000Z",
    });
    expect(parsed.status).toBe("pending");
    expect(parsed.inviter.name).toBe("Jane Doe");
  });
});
