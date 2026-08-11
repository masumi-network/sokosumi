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

vi.mock("next/server", () => ({
  connection: vi.fn().mockResolvedValue(undefined),
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

import { ChatRoomPageContent } from "../page";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const ORG_A = "org_a";
const ORG_B = "org_b";
const USER_ID = "user_1";

function room(
  overrides: {
    organizationId?: string | null;
    kind?: "channel" | "direct";
    myAccess?: "member" | "guest";
  } = {},
) {
  return {
    id: ROOM_ID,
    organizationId:
      "organizationId" in overrides ? overrides.organizationId : ORG_A,
    organizationName: null,
    kind: overrides.kind ?? "channel",
    name: "general",
    slug: "general",
    topic: null,
    directKey: null,
    discoverability: "public" as const,
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
    myAccess: overrides.myAccess ?? "member",
  };
}

/** Single-instance progressive open passes a promise into RoomsClient. */
function roomsClientProps(element: ReactElement) {
  return element.props as {
    selectedRoomId?: string;
    membersLoadFailed?: boolean;
    organizationMembers?: unknown[];
    messages?: unknown[];
    messagesNextCursor?: string | null;
    messagesPromise?: Promise<unknown>;
    messageLoadFailed?: boolean;
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
    // Page starts the load but does not await it — return a pending promise
    // so shell composition is not blocked by resolution.
    loadRoomMessagesMock.mockReturnValue(
      new Promise(() => {
        /* never resolves in shell tests */
      }),
    );
  });

  it("redirects when room belongs to a different active org", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_B,
      name: "Org B",
      slug: "org-b",
    });
    getRoomMock.mockResolvedValue(room({ organizationId: ORG_A }));

    await expect(
      ChatRoomPageContent({ params: Promise.resolve({ roomId: ROOM_ID }) }),
    ).rejects.toThrow(`REDIRECT:/chat?notice=room-unavailable`);

    expect(redirectMock).toHaveBeenCalledWith("/chat?notice=room-unavailable");
    expect(loadRoomMessagesMock).not.toHaveBeenCalled();
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
      ChatRoomPageContent({ params: Promise.resolve({ roomId: ROOM_ID }) }),
    ).rejects.toThrow(`REDIRECT:/chat?notice=room-unavailable`);

    expect(redirectMock).toHaveBeenCalledWith("/chat?notice=room-unavailable");
    expect(loadRoomMessagesMock).not.toHaveBeenCalled();
  });

  it("redirects when room is missing", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_A,
      name: "Org A",
      slug: "org-a",
    });
    getRoomMock.mockResolvedValue(null);

    await expect(
      ChatRoomPageContent({ params: Promise.resolve({ roomId: ROOM_ID }) }),
    ).rejects.toThrow(`REDIRECT:/chat?notice=room-unavailable`);
    expect(loadRoomMessagesMock).not.toHaveBeenCalled();
  });

  it("renders single RoomsClient with deferred messagesPromise", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_A,
      name: "Org A",
      slug: "org-a",
    });
    getRoomMock.mockResolvedValue(room({ organizationId: ORG_A }));

    const element = (await ChatRoomPageContent({
      params: Promise.resolve({ roomId: ROOM_ID }),
    })) as ReactElement;

    expect(element).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
    // History is started as a promise, not awaited before shell return.
    expect(loadRoomMessagesMock).toHaveBeenCalledWith(ROOM_ID);

    const props = roomsClientProps(element);
    expect(props.selectedRoomId).toBe(ROOM_ID);
    expect(props.messagesPromise).toBeInstanceOf(Promise);
    expect(props.messages).toEqual([]);
    expect(props.messagesNextCursor).toBeNull();
    expect(props.membersLoadFailed).toBe(false);
  });

  it("renders progressive guest room when active org is not the host org", async () => {
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_B,
      name: "Org B",
      slug: "org-b",
    });
    getRoomMock.mockResolvedValue(
      room({ organizationId: ORG_A, myAccess: "guest" }),
    );

    const element = (await ChatRoomPageContent({
      params: Promise.resolve({ roomId: ROOM_ID }),
    })) as ReactElement;

    expect(element).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(roomsClientProps(element).messagesPromise).toBeInstanceOf(Promise);
  });

  it("renders guest channel progressive shell in personal workspace", async () => {
    getActiveOrganizationMock.mockResolvedValue(null);
    getRoomMock.mockResolvedValue(
      room({ organizationId: ORG_A, myAccess: "guest" }),
    );

    const element = (await ChatRoomPageContent({
      params: Promise.resolve({ roomId: ROOM_ID }),
    })) as ReactElement;

    expect(element).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(roomsClientProps(element).messagesPromise).toBeInstanceOf(Promise);
  });

  it("still renders progressive shell when organization members fail to load", async () => {
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

    const element = (await ChatRoomPageContent({
      params: Promise.resolve({ roomId: ROOM_ID }),
    })) as ReactElement;

    expect(element).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(loadOrganizationMembersMock).toHaveBeenCalledWith(ORG_A);
    expect(loadRoomMessagesMock).toHaveBeenCalledWith(ROOM_ID);

    const props = roomsClientProps(element);
    expect(props.membersLoadFailed).toBe(true);
    expect(props.organizationMembers).toEqual([]);
    expect(props.messagesPromise).toBeInstanceOf(Promise);
  });

  it("treats personal workspace progressive shell as membersLoadFailed false", async () => {
    getActiveOrganizationMock.mockResolvedValue(null);
    getRoomMock.mockResolvedValue(
      room({ organizationId: null, kind: "direct" }),
    );

    const element = (await ChatRoomPageContent({
      params: Promise.resolve({ roomId: ROOM_ID }),
    })) as ReactElement;

    expect(element).toBeTruthy();
    expect(loadOrganizationMembersMock).not.toHaveBeenCalled();
    expect(loadRoomMessagesMock).toHaveBeenCalledWith(ROOM_ID);

    const props = roomsClientProps(element);
    expect(props.membersLoadFailed).toBe(false);
    expect(props.organizationMembers).toEqual([]);
    expect(props.messagesPromise).toBeInstanceOf(Promise);
  });
});

describe("ChatRoomPage deferred history promise", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: USER_ID } });
    getActiveOrganizationMock.mockResolvedValue({
      id: ORG_A,
      name: "Org A",
      slug: "org-a",
    });
    getRoomMock.mockResolvedValue(room({ organizationId: ORG_A }));
    loadOrganizationMembersMock.mockResolvedValue({
      members: [],
      failed: false,
    });
    listCoworkersMock.mockResolvedValue([]);
  });

  it("starts loadRoomMessages without awaiting so shell is not blocked", async () => {
    let resolveMessages!: (value: {
      messages: unknown[];
      nextCursor: string | null;
      failed: boolean;
    }) => void;
    const pending = new Promise<{
      messages: unknown[];
      nextCursor: string | null;
      failed: boolean;
    }>((resolve) => {
      resolveMessages = resolve;
    });
    loadRoomMessagesMock.mockReturnValue(pending);

    const element = (await ChatRoomPageContent({
      params: Promise.resolve({ roomId: ROOM_ID }),
    })) as ReactElement;

    // Shell returned while history promise still pending.
    expect(roomsClientProps(element).messagesPromise).toBe(pending);

    resolveMessages({
      messages: [{ id: "msg_1" }],
      nextCursor: "cursor_older",
      failed: false,
    });
    await expect(pending).resolves.toEqual({
      messages: [{ id: "msg_1" }],
      nextCursor: "cursor_older",
      failed: false,
    });
  });

  it("propagates load failure through the same messagesPromise", async () => {
    const failedPage = {
      messages: [],
      nextCursor: null,
      failed: true,
    };
    loadRoomMessagesMock.mockResolvedValue(failedPage);

    const element = (await ChatRoomPageContent({
      params: Promise.resolve({ roomId: ROOM_ID }),
    })) as ReactElement;

    await expect(roomsClientProps(element).messagesPromise).resolves.toEqual(
      failedPage,
    );
  });
});
