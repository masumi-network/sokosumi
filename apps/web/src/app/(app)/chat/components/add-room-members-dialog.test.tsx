import type { ChatRoom, Coworker, Member } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddRoomMembersDialog } from "./add-room-members-dialog";

const { addRoomMembersActionMock, refreshMock, toastMock } = vi.hoisted(() => ({
  addRoomMembersActionMock: vi.fn(),
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/app/chat/actions", () => ({
  addRoomMembersAction: addRoomMembersActionMock,
}));

vi.mock("./guest-invite-section", () => ({
  GuestInviteSection: () => <div data-testid="guest-invite-section" />,
}));

function member(id: string, name: string): Member {
  return {
    id: `member-${id}`,
    organizationId: "org-1",
    role: "member",
    seatAssignedAt: null,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    lastSeenAt: null,
    user: { id, name, email: `${id}@example.com`, image: null },
  };
}

function coworker(id: string, name: string): Coworker {
  return {
    id,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    updatedAt: new Date("2026-07-01T12:00:00.000Z"),
    archivedAt: null,
    isWhitelisted: true,
    priority: 0,
    slug: name.toLowerCase(),
    name,
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

function channel(overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id: "room-1",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "launch",
    slug: "launch",
    kind: "channel",
    isSelfDirect: false,
    isGroupDirect: false,
    isReadOnly: false,
    formerUserMembers: [],
    groupName: null,
    directKey: null,
    topic: null,
    discoverability: "public",
    createdByUserId: "user-me",
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
        id: "user-me",
        name: "Me",
        email: "me@example.com",
        image: null,
        presence: "offline",
        access: "member",
      },
    ],
    coworkerMembers: [
      {
        id: "cow-in",
        name: "Already",
        slug: "already",
        caption: null,
        image: null,
        presence: "online",
      },
    ],
    sokoBotMembers: [],
    ...overrides,
  };
}

const ownSokoBots = [
  { id: "bot-mine", name: "Minibot", image: null, avatarSeed: null },
  { id: "bot-in", name: "Inbot", image: null, avatarSeed: null },
];

function renderDialog(
  props: Partial<Parameters<typeof AddRoomMembersDialog>[0]> = {},
) {
  return render(
    <AddRoomMembersDialog
      room={channel({
        sokoBotMembers: [
          {
            id: "bot-in",
            name: "Inbot",
            caption: null,
            image: null,
            avatarSeed: null,
            ownerUserId: "user-me",
            presence: "online",
          },
        ],
      })}
      members={[member("user-me", "Me"), member("user-ada", "Ada")]}
      coworkers={[coworker("cow-in", "Already"), coworker("cow-new", "Soupie")]}
      sokoBots={ownSokoBots}
      membersLoadFailed={false}
      canInviteGuests={false}
      open
      onOpenChange={vi.fn()}
      {...props}
    />,
  );
}

describe("AddRoomMembersDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only people, Coworkers and own Soko Bots not in the channel yet", () => {
    renderDialog();

    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Soupie")).toBeInTheDocument();
    expect(screen.getByText("Minibot")).toBeInTheDocument();
    expect(screen.queryByText("Me")).toBeNull();
    expect(screen.queryByText("Already")).toBeNull();
    expect(screen.queryByText("Inbot")).toBeNull();
  });

  it("adds everyone picked in one submit", async () => {
    addRoomMembersActionMock.mockResolvedValue({ ok: true, value: channel() });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    await user.click(screen.getByText("Ada"));
    await user.click(screen.getByText("Soupie"));
    await user.click(screen.getByText("Minibot"));
    await user.click(screen.getByRole("button", { name: "submit" }));

    await waitFor(() => {
      expect(addRoomMembersActionMock).toHaveBeenCalledWith("room-1", {
        userIds: ["user-ada"],
        coworkerIds: ["cow-new"],
        sokoBotIds: ["bot-mine"],
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(refreshMock).toHaveBeenCalled();
  });

  it("asks for a pick instead of sending an empty add", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "submit" }));

    expect(addRoomMembersActionMock).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith("chooseSomeone");
  });

  it("says so when everyone is already in", () => {
    renderDialog({
      members: [member("user-me", "Me")],
      coworkers: [],
      sokoBots: [],
    });

    expect(screen.getByText("nobodyToAdd")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "submit" })).toBeNull();
  });

  it("offers a guest invite tab only when guests can be invited", async () => {
    const user = userEvent.setup();
    const { unmount } = renderDialog();
    expect(screen.queryByRole("tab")).toBeNull();
    unmount();

    renderDialog({ canInviteGuests: true });
    await user.click(screen.getByRole("tab", { name: "guestsTab" }));

    expect(screen.getByTestId("guest-invite-section")).toBeInTheDocument();
  });
});
