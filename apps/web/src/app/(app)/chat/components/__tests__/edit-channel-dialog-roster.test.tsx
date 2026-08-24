import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatRoom, Coworker, Member } from "@/lib/clients/generated/core";
import { EditChannelDialog } from "../edit-channel-dialog";

const { updateRoomActionMock } = vi.hoisted(() => ({
  updateRoomActionMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/app/chat/actions", () => ({
  archiveRoomAction: vi.fn(),
  leaveRoomAction: vi.fn(),
  updateRoomAction: updateRoomActionMock,
}));

const HOST_USER_ID = "user-host";
const GUEST_USER_ID = "user-guest";
const COWORKER_ID = "cow-soupie";

function hostMember(): Member {
  return {
    id: "member-host",
    organizationId: "org-1",
    role: "owner",
    seatAssignedAt: null,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    lastSeenAt: null,
    user: {
      id: HOST_USER_ID,
      name: "Ada",
      email: "ada@example.com",
      image: null,
    },
  };
}

function soupie(): Coworker {
  return {
    id: COWORKER_ID,
    name: "Soupie",
    slug: "soupie",
    caption: null,
    image: null,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
  } as Coworker;
}

function externalChannel(): ChatRoom {
  return {
    id: "019ff075-f49c-76cf-8104-39905b4fc081",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "general",
    slug: "general",
    kind: "channel",
    directKey: null,
    topic: null,
    discoverability: "external",
    createdByUserId: HOST_USER_ID,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    unreadCount: 0,
    unreadMentionCount: 0,
    pinnedAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [
      {
        id: HOST_USER_ID,
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
        access: "member",
      },
      {
        id: GUEST_USER_ID,
        name: "Guest",
        email: "guest@example.com",
        image: null,
        presence: "offline",
        access: "guest",
      },
    ],
    coworkerMembers: [
      {
        id: COWORKER_ID,
        name: "Soupie",
        slug: "soupie",
        caption: null,
        image: null,
        presence: "offline",
      },
    ],
  };
}

describe("EditChannelDialog host roster payload", () => {
  it("omits guest user ids from memberUserIds when saving a coworker onto an external channel", async () => {
    updateRoomActionMock.mockResolvedValue({
      ok: true,
      value: externalChannel(),
    });
    const user = userEvent.setup();

    render(
      <EditChannelDialog
        channel={externalChannel()}
        members={[hostMember()]}
        coworkers={[soupie()]}
        canEditMembers
        canManageSettings
        canArchive
        canLeave
        canInviteGuests={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "editChannel" }));
    await user.click(screen.getByRole("button", { name: "Dialog.save" }));

    await waitFor(() => {
      expect(updateRoomActionMock).toHaveBeenCalled();
    });

    const [, body] = updateRoomActionMock.mock.calls[0] as [
      string,
      { memberUserIds: string[]; coworkerIds: string[] },
    ];
    expect(body.memberUserIds).toEqual([HOST_USER_ID]);
    expect(body.memberUserIds).not.toContain(GUEST_USER_ID);
    expect(body.coworkerIds).toEqual([COWORKER_ID]);
  });
});
