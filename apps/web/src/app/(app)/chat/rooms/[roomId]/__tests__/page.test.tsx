import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();
const getActiveOrganizationMock = vi.fn();
const loadChatRoomMock = vi.fn();
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

vi.mock("@/app/chat/load-chat-room", () => ({
  loadChatRoom: (...args: unknown[]) => loadChatRoomMock(...args),
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
    loadChatRoomMock.mockResolvedValue({
      room: room({ organizationId: ORG_A }),
      failed: false,
    });

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
    loadChatRoomMock.mockResolvedValue({
      room: room({ organizationId: null, kind: "direct" }),
      failed: false,
    });

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
    loadChatRoomMock.mockResolvedValue({ room: null, failed: false });

    await expect(
      ChatRoomPage({ params: Promise.resolve({ roomId: ROOM_ID }) }),
    ).rejects.toThrow(`REDIRECT:/chat?notice=room-unavailable`);
  });

  it("redirects with load-failed notice when Core room GET fails", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_A,
      name: "Org A",
      slug: "org-a",
    });
    loadChatRoomMock.mockResolvedValue({ room: null, failed: true });

    await expect(
      ChatRoomPage({ params: Promise.resolve({ roomId: ROOM_ID }) }),
    ).rejects.toThrow(`REDIRECT:/chat?notice=room-load-failed`);

    expect(redirectMock).toHaveBeenCalledWith("/chat?notice=room-load-failed");
  });

  it("renders when room matches the active org", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_A,
      name: "Org A",
      slug: "org-a",
    });
    loadChatRoomMock.mockResolvedValue({
      room: room({ organizationId: ORG_A }),
      failed: false,
    });

    const element = await ChatRoomPage({
      params: Promise.resolve({ roomId: ROOM_ID }),
    });

    expect(element).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("still renders when organization members fail to load", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_A,
      name: "Org A",
      slug: "org-a",
    });
    loadChatRoomMock.mockResolvedValue({
      room: room({ organizationId: ORG_A }),
      failed: false,
    });
    loadOrganizationMembersMock.mockResolvedValue({
      members: [],
      failed: true,
    });

    const element = await ChatRoomPage({
      params: Promise.resolve({ roomId: ROOM_ID }),
    });

    expect(element).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(loadOrganizationMembersMock).toHaveBeenCalledWith(ORG_A);
  });
});
