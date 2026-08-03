import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getActiveOrganizationMock = vi.fn();
const getRoomMock = vi.fn();
const listCoworkersMock = vi.fn();
const loadOrganizationMembersMock = vi.fn();
const loadRoomMessagesMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("next-intl/server", () => ({
  getTranslations:
    async () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/services", () => ({
  chatRoomService: {
    getRoom: (...args: unknown[]) => getRoomMock(...args),
  },
  userService: {
    getActiveOrganization: (...args: unknown[]) =>
      getActiveOrganizationMock(...args),
  },
}));

vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: {
    listCoworkers: (...args: unknown[]) => listCoworkersMock(...args),
  },
}));

vi.mock("@/app/chat/load-organization-members", () => ({
  loadOrganizationMembers: (...args: unknown[]) =>
    loadOrganizationMembersMock(...args),
}));

vi.mock("@/app/chat/load-room-messages", () => ({
  loadRoomMessages: (...args: unknown[]) => loadRoomMessagesMock(...args),
}));

vi.mock("@/app/chat/components/rooms-client", () => ({
  RoomsClient: () => <div data-testid="rooms-client" />,
}));

import ChatRoomPage from "../page";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const ORG_A = "org_a";
const ORG_B = "org_b";
const USER_ID = "user_1";

function room(
  overrides: {
    organizationId?: string | null;
    kind?: "channel" | "direct";
  } = {},
) {
  return {
    id: ROOM_ID,
    organizationId:
      "organizationId" in overrides ? overrides.organizationId : ORG_A,
    kind: overrides.kind ?? "channel",
    name: "general",
    slug: "general",
    topic: null,
    directKey: null,
    createdByUserId: USER_ID,
    createdAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    updatedAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    archivedAt: null,
    userMembers: [],
    coworkerMembers: [],
    unreadCount: 0,
    unreadMentionCount: 0,
    pinnedAt: null,
    mutedAt: null,
    markedUnread: false,
  };
}

function roomsClientProps(element: ReactElement) {
  return element.props as {
    membersLoadFailed?: boolean;
    organizationMembers?: unknown[];
  };
}

describe("ChatRoomPage org deep-link guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: USER_ID } });
    loadOrganizationMembersMock.mockResolvedValue({
      members: [],
      failed: false,
    });
    listCoworkersMock.mockResolvedValue([]);
    loadRoomMessagesMock.mockResolvedValue({
      messages: [],
      nextCursor: null,
      failed: false,
    });
  });

  it("redirects when room belongs to a different active org", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_B,
      name: "Org B",
      slug: "org-b",
    });
    getRoomMock.mockResolvedValue(room({ organizationId: ORG_A }));

    await expect(
      ChatRoomPage({ params: Promise.resolve({ roomId: ROOM_ID }) }),
    ).rejects.toThrow(`REDIRECT:/chat?notice=room-unavailable`);

    expect(redirectMock).toHaveBeenCalledWith("/chat?notice=room-unavailable");
  });

  it("redirects when active-org user opens a personal direct", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_A,
      name: "Org A",
      slug: "org-a",
    });
    getRoomMock.mockResolvedValue(
      room({ organizationId: null, kind: "direct" }),
    );

    await expect(
      ChatRoomPage({ params: Promise.resolve({ roomId: ROOM_ID }) }),
    ).rejects.toThrow(`REDIRECT:/chat?notice=room-unavailable`);

    expect(redirectMock).toHaveBeenCalledWith("/chat?notice=room-unavailable");
  });

  it("redirects when room is missing", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_A,
      name: "Org A",
      slug: "org-a",
    });
    getRoomMock.mockResolvedValue(null);

    await expect(
      ChatRoomPage({ params: Promise.resolve({ roomId: ROOM_ID }) }),
    ).rejects.toThrow(`REDIRECT:/chat?notice=room-unavailable`);
  });

  it("renders when room matches the active org", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_A,
      name: "Org A",
      slug: "org-a",
    });
    getRoomMock.mockResolvedValue(room({ organizationId: ORG_A }));

    const element = (await ChatRoomPage({
      params: Promise.resolve({ roomId: ROOM_ID }),
    })) as ReactElement;

    expect(element).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(roomsClientProps(element).membersLoadFailed).toBe(false);
  });

  it("still renders when organization members fail to load", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_A,
      name: "Org A",
      slug: "org-a",
    });
    getRoomMock.mockResolvedValue(room({ organizationId: ORG_A }));
    loadOrganizationMembersMock.mockResolvedValue({
      members: [],
      failed: true,
    });

    const element = (await ChatRoomPage({
      params: Promise.resolve({ roomId: ROOM_ID }),
    })) as ReactElement;

    expect(element).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(loadOrganizationMembersMock).toHaveBeenCalledWith(ORG_A);
    expect(roomsClientProps(element).membersLoadFailed).toBe(true);
    expect(roomsClientProps(element).organizationMembers).toEqual([]);
  });

  it("treats personal workspace as membersLoadFailed false", async () => {
    getActiveOrganizationMock.mockResolvedValue(null);
    getRoomMock.mockResolvedValue(
      room({ organizationId: null, kind: "direct" }),
    );

    const element = (await ChatRoomPage({
      params: Promise.resolve({ roomId: ROOM_ID }),
    })) as ReactElement;

    expect(element).toBeTruthy();
    expect(loadOrganizationMembersMock).not.toHaveBeenCalled();
    expect(roomsClientProps(element).membersLoadFailed).toBe(false);
    expect(roomsClientProps(element).organizationMembers).toEqual([]);
  });
});
