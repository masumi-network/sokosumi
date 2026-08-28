import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationSeatProvider } from "@/contexts/organization-seat-context";
import type { ChatRoom, Coworker, Member } from "@/lib/clients/generated/core";
import { CreateDirectDialog } from "./create-direct-dialog";

const {
  loadChatComposeRosterActionMock,
  createDirectRoomActionMock,
  ensureCoworkerDirectRoomActionMock,
  notifyOrganizationChatRoomsChangedMock,
  assignMock,
} = vi.hoisted(() => ({
  loadChatComposeRosterActionMock: vi.fn(),
  createDirectRoomActionMock: vi.fn(),
  ensureCoworkerDirectRoomActionMock: vi.fn(),
  notifyOrganizationChatRoomsChangedMock: vi.fn(),
  assignMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { name?: string }) =>
    values?.name ? `${key}:${values.name}` : key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/app/chat/actions", () => ({
  loadChatComposeRosterAction: loadChatComposeRosterActionMock,
  createDirectRoomAction: createDirectRoomActionMock,
  ensureCoworkerDirectRoomAction: ensureCoworkerDirectRoomActionMock,
}));

vi.mock("@/components/chat/organization-chat-events", () => ({
  notifyOrganizationChatRoomsChanged: notifyOrganizationChatRoomsChangedMock,
}));

function renderSeated(ui: ReactElement) {
  return render(
    <OrganizationSeatProvider hasAssignedSeat={true}>
      {ui}
    </OrganizationSeatProvider>,
  );
}

function member(id: string, name: string): Member {
  return {
    id: `member-${id}`,
    organizationId: "org-1",
    role: "member",
    seatAssignedAt: null,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    lastSeenAt: null,
    user: {
      id,
      name,
      email: `${id}@example.com`,
      image: null,
    },
  };
}

function room(id: string): ChatRoom {
  return { id } as ChatRoom;
}

function coworker(id: string, name: string): Coworker {
  return { id, name, slug: name.toLowerCase() } as Coworker;
}

describe("CreateDirectDialog", () => {
  beforeEach(() => {
    assignMock.mockReset();
    vi.stubGlobal("location", { assign: assignMock });
    loadChatComposeRosterActionMock.mockReset();
    createDirectRoomActionMock.mockReset();
    ensureCoworkerDirectRoomActionMock.mockReset();
    notifyOrganizationChatRoomsChangedMock.mockReset();
    loadChatComposeRosterActionMock.mockResolvedValue({
      ok: true,
      value: {
        currentUserId: "user-self",
        organizationName: "Acme",
        hasOrganization: true,
        canCreateExternal: false,
        members: [member("user-self", "Ada"), member("user-2", "Francis")],
        coworkers: [],
        membersLoadFailed: false,
      },
    });
    createDirectRoomActionMock.mockResolvedValue({
      ok: true,
      value: room("room-direct"),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a Direct without navigating away first, then opens the room", async () => {
    const user = userEvent.setup();
    renderSeated(<CreateDirectDialog />);

    expect(screen.queryByRole("link")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Draft.title" }));

    await screen.findByRole("heading", { name: "Draft.title" });
    await user.click(await screen.findByRole("button", { name: /Francis/ }));
    await user.click(screen.getByRole("button", { name: "Dialog.create" }));

    await waitFor(() => {
      expect(createDirectRoomActionMock).toHaveBeenCalledWith({
        memberUserIds: ["user-2"],
      });
    });
    expect(ensureCoworkerDirectRoomActionMock).not.toHaveBeenCalled();
    expect(notifyOrganizationChatRoomsChangedMock).toHaveBeenCalledWith(
      room("room-direct"),
    );
    expect(assignMock).toHaveBeenCalledWith("/chat/rooms/room-direct");
  });

  it("create-or-gets a coworker Direct without a first message", async () => {
    loadChatComposeRosterActionMock.mockResolvedValue({
      ok: true,
      value: {
        currentUserId: "user-self",
        organizationName: "",
        hasOrganization: false,
        canCreateExternal: false,
        members: [],
        coworkers: [coworker("coworker-1", "Hannah")],
        membersLoadFailed: false,
      },
    });
    ensureCoworkerDirectRoomActionMock.mockResolvedValue({
      ok: true,
      value: room("room-coworker"),
    });
    const user = userEvent.setup();
    renderSeated(<CreateDirectDialog />);

    await user.click(screen.getByRole("button", { name: "Draft.title" }));
    await user.click(await screen.findByRole("button", { name: /Hannah/ }));
    await user.click(screen.getByRole("button", { name: "Dialog.create" }));

    await waitFor(() => {
      expect(ensureCoworkerDirectRoomActionMock).toHaveBeenCalledWith(
        "coworker-1",
      );
    });
    expect(createDirectRoomActionMock).not.toHaveBeenCalled();
    expect(assignMock).toHaveBeenCalledWith("/chat/rooms/room-coworker");
  });

  it("retries a members-only roster failure through loadRoster", async () => {
    loadChatComposeRosterActionMock.mockResolvedValue({
      ok: true,
      value: {
        currentUserId: "user-self",
        organizationName: "Acme",
        hasOrganization: true,
        canCreateExternal: false,
        members: [],
        coworkers: [coworker("coworker-1", "Hannah")],
        membersLoadFailed: true,
      },
    });
    const user = userEvent.setup();
    renderSeated(<CreateDirectDialog />);

    await user.click(screen.getByRole("button", { name: "Draft.title" }));
    await screen.findByText("Empty.membersLoadFailedTitle");
    await screen.findByRole("button", { name: /Hannah/ });

    await user.click(
      screen.getByRole("button", { name: "Empty.membersLoadFailedRetry" }),
    );
    await waitFor(() => {
      expect(loadChatComposeRosterActionMock).toHaveBeenCalledTimes(2);
    });
  });

  it("ends the roster spinner when load fails", async () => {
    loadChatComposeRosterActionMock.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "Roster down" },
    });
    const user = userEvent.setup();
    renderSeated(<CreateDirectDialog />);

    await user.click(screen.getByRole("button", { name: "Draft.title" }));
    await screen.findByRole("heading", { name: "Draft.title" });
    await waitFor(() => {
      expect(screen.queryByText("loading")).toBeNull();
    });
    expect(screen.getByText("Empty.rosterLoadFailedTitle")).toBeTruthy();
    expect(screen.queryByText("NoOrganization.description")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Empty.membersLoadFailedRetry" }),
    );
    await waitFor(() => {
      expect(loadChatComposeRosterActionMock).toHaveBeenCalledTimes(2);
    });
    expect(createDirectRoomActionMock).not.toHaveBeenCalled();
  });

  it("keeps the search composer visible while the roster loads", async () => {
    loadChatComposeRosterActionMock.mockImplementation(
      () => new Promise(() => {}),
    );
    const user = userEvent.setup();
    renderSeated(<CreateDirectDialog />);

    await user.click(screen.getByRole("button", { name: "Draft.title" }));
    await screen.findByRole("heading", { name: "Draft.title" });

    expect(screen.getByPlaceholderText("Draft.searchPlaceholder")).toBeTruthy();
    expect(screen.getByText("loading")).toBeTruthy();
    expect(
      screen
        .getByTestId("direct-recipient-composer")
        .contains(screen.getByPlaceholderText("Draft.searchPlaceholder")),
    ).toBe(true);
  });

  it("scrolls a fixed-height roster pane and keeps chips in the composer", async () => {
    const user = userEvent.setup();
    renderSeated(<CreateDirectDialog />);

    await user.click(screen.getByRole("button", { name: "Draft.title" }));
    await screen.findByRole("button", { name: /Francis/ });

    const scrollport = screen.getByTestId("direct-roster-scrollport");
    expect(scrollport).toHaveClass("overflow-y-auto");
    expect(scrollport.parentElement).toHaveClass("flex-1");
    expect(scrollport.parentElement).toHaveClass("min-h-0");
    expect(scrollport.contains(screen.getByText("Francis"))).toBe(true);
    expect(screen.getByTestId("direct-roster-edge-fade")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Francis/ }));
    const composer = screen.getByTestId("direct-recipient-composer");
    expect(composer.contains(screen.getByText("Francis"))).toBe(true);
    expect(
      composer.contains(
        screen.getByPlaceholderText("Draft.searchPlaceholderMore"),
      ),
    ).toBe(true);
    expect(scrollport.parentElement).toHaveClass("flex-1");
  });

  it("closes without routing when dismissed", async () => {
    const user = userEvent.setup();
    renderSeated(<CreateDirectDialog />);

    await user.click(screen.getByRole("button", { name: "Draft.title" }));
    await screen.findByRole("heading", { name: "Draft.title" });
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Draft.title" })).toBeNull();
    });
    expect(assignMock).not.toHaveBeenCalled();
    expect(createDirectRoomActionMock).not.toHaveBeenCalled();
  });

  it("still lists AI coworkers when the viewer has no assigned seat", async () => {
    loadChatComposeRosterActionMock.mockResolvedValue({
      ok: true,
      value: {
        currentUserId: "user-self",
        organizationName: "Acme",
        hasOrganization: true,
        canCreateExternal: false,
        members: [member("user-self", "Ada"), member("user-2", "Francis")],
        coworkers: [coworker("cow-1", "Hermes")],
        membersLoadFailed: false,
      },
    });
    const user = userEvent.setup();
    render(
      <OrganizationSeatProvider hasAssignedSeat={false}>
        <CreateDirectDialog />
      </OrganizationSeatProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Draft.title" }));
    await screen.findByRole("heading", { name: "Draft.title" });

    expect(screen.getByRole("button", { name: /Hermes/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Francis/ })).toBeTruthy();
  });
});
