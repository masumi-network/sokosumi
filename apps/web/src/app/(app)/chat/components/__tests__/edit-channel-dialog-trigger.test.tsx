import { render, screen } from "@testing-library/react";
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
    pinnedAt: null,
    mutedAt: null,
    markedUnread: false,
    myAccess: "member",
    userMembers: [],
    coworkerMembers: [],
  };
}

describe("EditChannelDialog trigger", () => {
  it("uses the gear icon, not sliders", () => {
    render(
      <EditChannelDialog
        channel={channel()}
        members={[]}
        coworkers={[]}
        canEditMembers={false}
        canManageSettings={false}
        canArchive={false}
        canLeave={false}
      />,
    );

    const trigger = screen.getByRole("button", { name: "editChannel" });
    const icon = trigger.querySelector("svg");
    expect(icon?.classList.contains("lucide-settings")).toBe(true);
    expect(icon?.classList.contains("lucide-settings-2")).toBe(false);
  });
});
