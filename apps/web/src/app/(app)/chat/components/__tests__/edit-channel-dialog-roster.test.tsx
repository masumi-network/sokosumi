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
const CHANNEL_ID = "019ff075-f49c-76cf-8104-39905b4fc081";

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
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    archivedAt: null,
    isWhitelisted: true,
    priority: 0,
    slug: "soupie",
    name: "Soupie",
    caption: null,
    vendor: {
      id: "vendor-1",
      createdAt: new Date("2026-07-01T12:00:00.000Z"),
      updatedAt: new Date("2026-07-01T12:00:00.000Z"),
      name: "Acme",
      slug: "acme",
      logos: { light: null, dark: null },
    },
    url: null,
    baseURL: "https://chat.example.com",
    description: null,
    capabilities: ["chat"],
    image: null,
  };
}

function externalChannel(): ChatRoom {
  return {
    id: CHANNEL_ID,
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
    starredAt: null,
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
    coworkerMembers: [],
  };
}

describe("EditChannelDialog host roster payload", () => {
  it("omits guest user ids from memberUserIds when adding a coworker on an external channel", async () => {
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
        currentUserId={HOST_USER_ID}
        canEditMembers
        canManageSettings
        canArchive
        canLeave
        canInviteGuests={false}
      >
        <button type="button" aria-label="editChannel">
          edit
        </button>
      </EditChannelDialog>,
    );

    await user.click(screen.getByRole("button", { name: "editChannel" }));
    await user.click(screen.getByText("Soupie"));
    await user.click(screen.getByRole("button", { name: "Dialog.save" }));

    await waitFor(() => {
      expect(updateRoomActionMock).toHaveBeenCalledWith(
        CHANNEL_ID,
        expect.objectContaining({
          memberUserIds: [HOST_USER_ID],
          coworkerIds: [COWORKER_ID],
          orchestratorIds: [],
        }),
      );
    });
  });

  it("keeps the current user on the host roster when their row is clicked", async () => {
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
        currentUserId={HOST_USER_ID}
        canEditMembers
        canManageSettings
        canArchive
        canLeave
        canInviteGuests={false}
      >
        <button type="button" aria-label="editChannel">
          edit
        </button>
      </EditChannelDialog>,
    );

    await user.click(screen.getByRole("button", { name: "editChannel" }));
    await user.click(screen.getByText("Ada"));
    await user.click(screen.getByText("Soupie"));
    await user.click(screen.getByRole("button", { name: "Dialog.save" }));

    await waitFor(() => {
      expect(updateRoomActionMock).toHaveBeenCalledWith(
        CHANNEL_ID,
        expect.objectContaining({
          memberUserIds: [HOST_USER_ID],
          coworkerIds: [COWORKER_ID],
          orchestratorIds: [],
        }),
      );
    });
  });
});
