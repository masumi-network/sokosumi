import type { ChatRoom } from "@/lib/clients/generated/core";

/** A room member, as the row's roster and Leave rules see one. */
export function makeUser(id: string, access: "member" | "guest" = "member") {
  return {
    id,
    name: `User ${id}`,
    email: `${id}@example.com`,
    image: null,
    presence: "offline" as const,
    access,
  };
}

/**
 * A sidebar room, built field by field so the DTO shape stays honest. Shared by
 * the row's two test files: one mocks next-intl, the other renders through the
 * real English catalog, and both need the same room.
 */
export function makeRoom(overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id: "room-1",
    organizationId: "org-1",
    organizationName: null,
    name: "general",
    slug: "general",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "public",
    createdByUserId: "user-1",
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    starredAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [makeUser("user-1"), makeUser("user-2")],
    coworkerMembers: [],
    ...overrides,
    sokoBotMembers: overrides.sokoBotMembers ?? [],
  };
}
