import type { ChatRoom } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentProps, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { EditChannelDialog } from "./edit-channel-dialog";

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
  updateRoomAction: updateRoomActionMock,
}));

function channel(overrides: Partial<ChatRoom> = {}): ChatRoom {
  return {
    id: "room-channel",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "general",
    slug: "general",
    kind: "channel",
    isSelfDirect: false,
    isGroupDirect: false,
    groupName: null,
    directKey: null,
    topic: null,
    discoverability: "public",
    createdByUserId: "user-1",
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
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
        presence: "offline",
        access: "member",
      },
    ],
    coworkerMembers: [],
    sokoBotMembers: [],
    ...overrides,
  };
}

/** The room shell owns the open flag; this stands in for it. */
function ShellOwnedEditChannelDialog(
  props: Omit<
    ComponentProps<typeof EditChannelDialog>,
    "open" | "onOpenChange" | "children" | "onManageGuests"
  > & { onManageGuests?: () => void },
) {
  const [open, setOpen] = useState(false);
  return (
    <EditChannelDialog
      {...props}
      onManageGuests={props.onManageGuests ?? vi.fn()}
      open={open}
      onOpenChange={setOpen}
    >
      <button type="button" aria-label="editChannel">
        general
      </button>
    </EditChannelDialog>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "editChannel" }));
  return user;
}

describe("EditChannelDialog", () => {
  it("offers name, topic, visibility and Archive, and no roster", async () => {
    render(<ShellOwnedEditChannelDialog channel={channel()} />);
    await openDialog();

    expect(
      screen.getByRole("heading", { name: "Dialog.editTitle" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Dialog.name")).toHaveValue("general");
    expect(screen.getByLabelText("Dialog.topic")).toBeInTheDocument();
    expect(screen.getByText("Visibility.label")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "archiveButton" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Dialog.participants")).toBeNull();
    expect(screen.queryByRole("button", { name: "leave" })).toBeNull();
  });

  it("keeps Save off until something changes", async () => {
    render(<ShellOwnedEditChannelDialog channel={channel()} />);
    const user = await openDialog();

    const save = screen.getByRole("button", { name: "Dialog.save" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("Dialog.topic"), "News");
    expect(save).toBeEnabled();

    await user.clear(screen.getByLabelText("Dialog.topic"));
    expect(save).toBeDisabled();
  });

  it("saves settings only", async () => {
    updateRoomActionMock.mockResolvedValue({ ok: true, value: channel() });
    render(<ShellOwnedEditChannelDialog channel={channel()} />);
    const user = await openDialog();

    await user.type(screen.getByLabelText("Dialog.topic"), "News");
    await user.click(screen.getByLabelText("Visibility.private"));
    await user.click(screen.getByRole("button", { name: "Dialog.save" }));

    await waitFor(() => {
      expect(updateRoomActionMock).toHaveBeenCalledWith("room-channel", {
        name: "general",
        topic: "News",
        discoverability: "private",
      });
    });
  });

  it("locks Public and Private on an External channel with guests", async () => {
    const room = channel({
      discoverability: "external",
      userMembers: [
        ...channel().userMembers,
        {
          id: "guest-1",
          name: "Gus",
          email: "gus@example.com",
          image: null,
          presence: "offline",
          access: "guest",
        },
      ],
    });
    const onManageGuests = vi.fn();
    render(
      <ShellOwnedEditChannelDialog
        channel={room}
        onManageGuests={onManageGuests}
      />,
    );
    const user = await openDialog();

    expect(screen.getByLabelText("Visibility.public")).toBeDisabled();
    expect(screen.getByLabelText("Visibility.private")).toBeDisabled();
    expect(screen.getByLabelText("Visibility.external")).toBeEnabled();
    expect(screen.getByText("Visibility.externalLocked")).toBeInTheDocument();
    expect(screen.getAllByText("Visibility.hasGuests")).toHaveLength(2);
    await user.click(
      screen.getByRole("button", { name: "Visibility.manageGuests" }),
    );
    expect(onManageGuests).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("leaves visibility open on an External channel without guests", async () => {
    render(
      <ShellOwnedEditChannelDialog
        channel={channel({ discoverability: "external" })}
      />,
    );
    await openDialog();

    expect(screen.getByLabelText("Visibility.public")).toBeEnabled();
    expect(screen.queryByText("Visibility.externalLocked")).toBeNull();
  });
});
