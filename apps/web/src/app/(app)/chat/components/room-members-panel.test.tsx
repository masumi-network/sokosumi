import type { ChatRoom } from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomMembersPanel } from "./room-members-panel";

const {
  addRoomMembersActionMock,
  leaveRoomActionMock,
  removeRoomCoworkerActionMock,
  removeRoomMemberActionMock,
  removeRoomSokoBotActionMock,
  refreshMock,
  replaceMock,
  toastMock,
} = vi.hoisted(() => ({
  addRoomMembersActionMock: vi.fn(),
  leaveRoomActionMock: vi.fn(),
  removeRoomCoworkerActionMock: vi.fn(),
  removeRoomMemberActionMock: vi.fn(),
  removeRoomSokoBotActionMock: vi.fn(),
  refreshMock: vi.fn(),
  replaceMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, replace: replaceMock }),
}));

// Keys come back relative to App.Channels ("Actions.leave"), with a name
// value appended where one is passed.
vi.mock("next-intl", () => ({
  useTranslations:
    (namespace = "") =>
    (key: string, values?: Record<string, string | number>) => {
      const prefix = namespace.replace(/^App\.Channels\.?/, "");
      const path = prefix ? `${prefix}.${key}` : key;
      return values?.name !== undefined ? `${path}:${values.name}` : path;
    },
  useFormatter: () => ({
    relativeTime: (date: Date) => date.toISOString(),
  }),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/app/chat/actions", () => ({
  addRoomMembersAction: addRoomMembersActionMock,
  leaveRoomAction: leaveRoomActionMock,
  removeRoomCoworkerAction: removeRoomCoworkerActionMock,
  removeRoomMemberAction: removeRoomMemberActionMock,
  removeRoomSokoBotAction: removeRoomSokoBotActionMock,
}));

vi.mock("@/components/chat/organization-chat-events", () => ({
  notifyOrganizationChatRoomsChanged: vi.fn(),
}));

vi.mock("./add-room-members-dialog", () => ({
  AddRoomMembersDialog: ({
    open,
    canInviteGuests,
  }: {
    open: boolean;
    canInviteGuests: boolean;
  }) => (
    <div
      data-testid="add-members-dialog-probe"
      data-open={String(open)}
      data-invite-guests={String(canInviteGuests)}
    />
  ),
}));

const ME = "user-me";

function user(
  id: string,
  name: string,
  access: "member" | "guest",
): ChatRoom["userMembers"][number] {
  return {
    id,
    name,
    email: `${id}@example.com`,
    image: null,
    presence: "offline",
    access,
  };
}

function externalChannel(overrides: Partial<ChatRoom> = {}): ChatRoom {
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
      user(ME, "Me", "member"),
      user("user-bob", "Bob", "member"),
      user("user-gus", "Gus", "guest"),
    ],
    coworkerMembers: [
      {
        id: "cow-1",
        name: "Soupie",
        slug: "soupie",
        caption: null,
        image: null,
        presence: "online",
      },
    ],
    sokoBotMembers: [
      {
        id: "bot-mine",
        name: "Minibot",
        caption: null,
        image: null,
        avatarSeed: null,
        ownerUserId: ME,
        presence: "online",
      },
      {
        id: "bot-bob",
        name: "Bobbot",
        caption: null,
        image: null,
        avatarSeed: null,
        ownerUserId: "user-bob",
        presence: "online",
      },
    ],
    ...overrides,
  };
}

function renderPanel(
  room: ChatRoom,
  { isOrgOwnerOrAdmin = false }: { isOrgOwnerOrAdmin?: boolean } = {},
) {
  return render(
    <RoomMembersPanel
      room={room}
      currentUserId={ME}
      isOrgOwnerOrAdmin={isOrgOwnerOrAdmin}
      organizationMembers={[]}
      coworkers={[]}
      sokoBots={[]}
      membersLoadFailed={false}
      canOpenHumanDirect={false}
      onOpenDirect={vi.fn()}
      openingDirectKey={null}
      onClose={vi.fn()}
      readStateFor={() => null}
    />,
  );
}

function removableNames(): string[] {
  return screen
    .queryAllByTestId("room-roster-member-actions")
    .map((button) =>
      (button.getAttribute("aria-label") ?? "").replace(
        "RoomRoster.memberActions:",
        "",
      ),
    );
}

async function chooseRemove(name: string) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: `RoomRoster.memberActions:${name}` }),
  );
  await user.click(screen.getByRole("menuitem", { name: "RoomRoster.remove" }));
  return user;
}

describe("RoomMembersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets a host member add, remove guests, Coworkers and their own Soko Bot, and leave", () => {
    renderPanel(externalChannel());

    expect(screen.getByTestId("room-roster-add")).toBeInTheDocument();
    expect(removableNames()).toEqual(["Gus", "Soupie", "Minibot"]);
    expect(
      screen.getByRole("button", { name: "Actions.leave" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("room-roster-section-guests")).toHaveTextContent(
      "RoomRoster.guestsTitle1",
    );
  });

  it("lets an owner or admin remove host members too, but never themselves", () => {
    renderPanel(externalChannel(), { isOrgOwnerOrAdmin: true });

    expect(removableNames()).toEqual(["Bob", "Gus", "Soupie", "Minibot"]);
  });

  it("gives a guest a read-only roster they can leave", () => {
    renderPanel(
      externalChannel({
        myAccess: "guest",
        userMembers: [
          user("user-bob", "Bob", "member"),
          user(ME, "Me", "guest"),
        ],
      }),
    );

    expect(screen.queryByTestId("room-roster-add")).toBeNull();
    expect(removableNames()).toEqual([]);
    expect(
      screen.getByRole("button", { name: "Actions.leave" }),
    ).toBeInTheDocument();
  });

  it("keeps a matched channel read-only", () => {
    renderPanel(externalChannel({ discoverability: "matched" }), {
      isOrgOwnerOrAdmin: true,
    });

    expect(screen.queryByTestId("room-roster-add")).toBeNull();
    expect(removableNames()).toEqual([]);
  });

  it("keeps a Direct's roster as it was", () => {
    renderPanel(
      externalChannel({
        kind: "direct",
        discoverability: null,
        userMembers: [
          user(ME, "Me", "member"),
          user("user-bob", "Bob", "member"),
        ],
      }),
    );

    expect(screen.queryByTestId("room-roster-add")).toBeNull();
    expect(removableNames()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Actions.leave" })).toBeNull();
  });

  it("opens the picker from Add, with the guest invite tab on an External channel", async () => {
    const user = userEvent.setup();
    renderPanel(externalChannel());

    const probe = screen.getByTestId("add-members-dialog-probe");
    expect(probe).toHaveAttribute("data-open", "false");
    expect(probe).toHaveAttribute("data-invite-guests", "true");

    await user.click(screen.getByTestId("room-roster-add"));

    expect(probe).toHaveAttribute("data-open", "true");
  });

  it("asks before removing a person", async () => {
    removeRoomMemberActionMock.mockResolvedValue({ ok: true, value: null });
    renderPanel(externalChannel());

    const user = await chooseRemove("Gus");

    expect(removeRoomMemberActionMock).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog");
    expect(
      within(confirm).getByText("RoomRoster.removeConfirmTitle:Gus"),
    ).toBeInTheDocument();

    await user.click(
      within(confirm).getByRole("button", { name: "RoomRoster.remove" }),
    );

    await waitFor(() => {
      expect(removeRoomMemberActionMock).toHaveBeenCalledWith(
        "room-1",
        "user-gus",
      );
    });
    expect(toastMock.success).toHaveBeenCalledWith(
      "RoomRoster.removeSuccess:Gus",
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it("removes a Coworker at once and offers Undo, which adds it back", async () => {
    removeRoomCoworkerActionMock.mockResolvedValue({
      ok: true,
      value: externalChannel(),
    });
    addRoomMembersActionMock.mockResolvedValue({
      ok: true,
      value: externalChannel(),
    });
    renderPanel(externalChannel());

    await chooseRemove("Soupie");

    await waitFor(() => {
      expect(removeRoomCoworkerActionMock).toHaveBeenCalledWith(
        "room-1",
        "cow-1",
      );
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const [message, options] = toastMock.success.mock.calls[0];
    expect(message).toBe("RoomRoster.removeSuccess:Soupie");
    expect(options.action.label).toBe("RoomRoster.undo");
    expect(options.duration).toBe(Infinity);
    expect(options.closeButton).toBe(true);

    options.action.onClick();

    await waitFor(() => {
      expect(addRoomMembersActionMock).toHaveBeenCalledWith("room-1", {
        coworkerIds: ["cow-1"],
      });
    });
  });

  it("removes your own Soko Bot at once and offers Undo", async () => {
    removeRoomSokoBotActionMock.mockResolvedValue({
      ok: true,
      value: externalChannel(),
    });
    addRoomMembersActionMock.mockResolvedValue({
      ok: true,
      value: externalChannel(),
    });
    renderPanel(externalChannel());

    await chooseRemove("Minibot");

    await waitFor(() => {
      expect(removeRoomSokoBotActionMock).toHaveBeenCalledWith(
        "room-1",
        "bot-mine",
      );
    });
    const [, options] = toastMock.success.mock.calls[0];
    options.action.onClick();

    await waitFor(() => {
      expect(addRoomMembersActionMock).toHaveBeenCalledWith("room-1", {
        sokoBotIds: ["bot-mine"],
      });
    });
  });

  it("leaves after confirming and lands on the room list", async () => {
    leaveRoomActionMock.mockResolvedValue({
      ok: true,
      value: { id: "room-1" },
    });
    const user = userEvent.setup();
    renderPanel(externalChannel());

    await user.click(screen.getByRole("button", { name: "Actions.leave" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Actions.leaveConfirm",
      }),
    );

    await waitFor(() => {
      expect(leaveRoomActionMock).toHaveBeenCalledWith("room-1");
    });
    expect(replaceMock).toHaveBeenCalledWith("/");
  });

  it("reports a failed Undo without claiming the member returned", async () => {
    removeRoomCoworkerActionMock.mockResolvedValue({
      ok: true,
      value: externalChannel(),
    });
    addRoomMembersActionMock.mockResolvedValue({
      ok: false,
      error: { message: "Unable to restore. Try adding again." },
    });
    renderPanel(externalChannel());
    await chooseRemove("Soupie");
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    refreshMock.mockClear();
    const [, options] = toastMock.success.mock.calls[0];
    options.action.onClick();
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        "Unable to restore. Try adding again.",
      ),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
