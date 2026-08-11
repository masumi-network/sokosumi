import type { ReactElement, ReactNode } from "react";
import { Suspense } from "react";
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

import {
  ChatRoomPageContent,
  type ChatRoomShellProps,
  ChatRoomWithMessages,
} from "../page";

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

/** Props on the shell wrapper that eventually renders RoomsClient. */
function shellClientProps(element: ReactElement) {
  return element.props as {
    shell: ChatRoomShellProps;
    messagesPending?: boolean;
    messageLoadFailed?: boolean;
    messages?: unknown[];
    messagesNextCursor?: string | null;
  };
}

/** Progressive open wraps history behind Suspense with a messagesPending fallback. */
function progressiveFallback(element: ReactElement): ReactElement {
  expect(element.type).toBe(Suspense);
  const fallback = (element.props as { fallback: ReactNode }).fallback;
  expect(fallback).toBeTruthy();
  return fallback as ReactElement;
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

  it("renders progressive shell when room matches the active org", async () => {
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
    // Shell paints without waiting for history.
    expect(loadRoomMessagesMock).not.toHaveBeenCalled();

    const fallback = progressiveFallback(element);
    const props = shellClientProps(fallback);
    expect(props.messagesPending).toBe(true);
    expect(props.messageLoadFailed).toBe(false);
    expect(props.shell.membersLoadFailed).toBe(false);
    expect(props.shell.selectedRoomId).toBe(ROOM_ID);
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
    expect(loadRoomMessagesMock).not.toHaveBeenCalled();
    expect(shellClientProps(progressiveFallback(element)).messagesPending).toBe(
      true,
    );
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
    expect(loadRoomMessagesMock).not.toHaveBeenCalled();
    expect(shellClientProps(progressiveFallback(element)).messagesPending).toBe(
      true,
    );
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
    expect(loadRoomMessagesMock).not.toHaveBeenCalled();

    const props = shellClientProps(progressiveFallback(element));
    expect(props.shell.membersLoadFailed).toBe(true);
    expect(props.shell.organizationMembers).toEqual([]);
    expect(props.messagesPending).toBe(true);
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
    expect(loadRoomMessagesMock).not.toHaveBeenCalled();

    const props = shellClientProps(progressiveFallback(element));
    expect(props.shell.membersLoadFailed).toBe(false);
    expect(props.shell.organizationMembers).toEqual([]);
    expect(props.messagesPending).toBe(true);
  });
});

describe("ChatRoomWithMessages history island", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadRoomMessagesMock.mockResolvedValue({
      messages: [{ id: "msg_1" }],
      nextCursor: "cursor_older",
      failed: false,
    });
  });

  function baseShell(): ChatRoomShellProps {
    return {
      activeOrganization: {
        id: ORG_A,
        name: "Org A",
        slug: "org-a",
      } as ChatRoomShellProps["activeOrganization"],
      rooms: [
        room({
          organizationId: ORG_A,
        }) as unknown as ChatRoomShellProps["rooms"][0],
      ],
      organizationMembers: [],
      currentUserId: USER_ID,
      coworkers: [],
      selectedRoomId: ROOM_ID,
      membersLoadFailed: false,
    };
  }

  it("loads message history and renders RoomsClient without pending flag", async () => {
    const element = (await ChatRoomWithMessages({
      shell: baseShell(),
      roomId: ROOM_ID,
    })) as ReactElement;

    expect(loadRoomMessagesMock).toHaveBeenCalledWith(ROOM_ID);
    const props = shellClientProps(element);
    expect(props.messagesPending).toBeFalsy();
    expect(props.messageLoadFailed).toBe(false);
    expect(props.messages).toEqual([{ id: "msg_1" }]);
    expect(props.messagesNextCursor).toBe("cursor_older");
  });

  it("surfaces message load failure on the history island", async () => {
    loadRoomMessagesMock.mockResolvedValue({
      messages: [],
      nextCursor: null,
      failed: true,
    });

    const element = (await ChatRoomWithMessages({
      shell: baseShell(),
      roomId: ROOM_ID,
    })) as ReactElement;

    const props = shellClientProps(element);
    expect(props.messageLoadFailed).toBe(true);
    expect(props.messagesPending).toBeFalsy();
    expect(props.messages).toEqual([]);
  });

  it("connects progressive shell fallback to the same room as history island", async () => {
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

    const shellTree = (await ChatRoomPageContent({
      params: Promise.resolve({ roomId: ROOM_ID }),
    })) as ReactElement;
    const fallback = progressiveFallback(shellTree);
    const fallbackProps = shellClientProps(fallback);

    const withMessages = (await ChatRoomWithMessages({
      shell: fallbackProps.shell,
      roomId: ROOM_ID,
    })) as ReactElement;
    const historyProps = shellClientProps(withMessages);

    expect(fallbackProps.shell.selectedRoomId).toBe(ROOM_ID);
    expect(historyProps.shell.selectedRoomId).toBe(ROOM_ID);
    expect(fallbackProps.messagesPending).toBe(true);
    expect(historyProps.messagesPending).toBeFalsy();
  });
});
