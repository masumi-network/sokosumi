import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { EditChannelDialog } from "../edit-channel-dialog";

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

function channel(): ChatRoom {
  return {
    id: "room-channel",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "general",
    slug: "general",
    kind: "channel",
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
    userMembers: [],
    coworkerMembers: [],
    sokoBotMembers: [],
  };
}

describe("EditChannelDialog trigger", () => {
  it("opens from the provided trigger and has no settings gear", async () => {
    const user = userEvent.setup();
    render(
      <EditChannelDialog
        channel={channel()}
        members={[]}
        coworkers={[]}
        currentUserId="user-1"
        canEditMembers={false}
        canManageSettings={false}
        canArchive={false}
        canLeave={false}
      >
        <button type="button" aria-label="editChannel" title="editChannel">
          general
        </button>
      </EditChannelDialog>,
    );

    const trigger = screen.getByRole("button", { name: "editChannel" });
    expect(trigger).toHaveTextContent("general");
    expect(document.querySelector(".lucide-settings")).toBeNull();

    await user.click(trigger);
    expect(
      screen.getByRole("heading", { name: "Dialog.editTitle" }),
    ).toBeTruthy();
  });

  it("uses leave-only copy when the member can leave but not edit", async () => {
    const user = userEvent.setup();
    render(
      <EditChannelDialog
        channel={channel()}
        members={[]}
        coworkers={[]}
        currentUserId="user-1"
        canEditMembers={false}
        canManageSettings={false}
        canArchive={false}
        canLeave
      >
        <button type="button" aria-label="editChannel" title="editChannel">
          general
        </button>
      </EditChannelDialog>,
    );

    await user.click(screen.getByRole("button", { name: "editChannel" }));
    expect(
      screen.getByRole("heading", { name: "Dialog.actionsOnlyTitle" }),
    ).toBeTruthy();
    expect(screen.getByText("Dialog.actionsOnlyDescription")).toBeTruthy();
    expect(screen.getByRole("button", { name: "leave" })).toBeTruthy();
    expect(screen.queryByText("sectionTitle")).toBeNull();
    expect(screen.queryByRole("button", { name: "Dialog.cancel" })).toBeNull();
  });
});
