import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import { ChatRoomSidebarRow } from "@/components/chat/chat-room-sidebar-row";
import type { ChatRoom } from "@/lib/clients/generated/core";
import { makeRoom } from "./chat-room-fixtures";

// This file deliberately does not mock `next-intl`. The sibling
// `chat-room-sidebar-row.test.tsx` does, which is right for behaviour tests but
// leaves two things unproven: that the key paths the row asks for exist in the
// catalog, and that the ICU plurals read correctly at one and at many. Both are
// what SOK-1042 set out to fix, so both are rendered here for real.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/chat/use-show-room-unread-count", () => ({
  useShowRoomUnreadCount: () => true,
}));

// The real module under the overrides, so `SidebarRowSlot` — the shared
// leading slot every row sits its mark in — is the one the app ships.
vi.mock("@/components/ui/sidebar", async () => ({
  ...(await vi.importActual<typeof import("@/components/ui/sidebar")>(
    "@/components/ui/sidebar",
  )),
  SidebarMenuButton: ({
    children,
    asChild,
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) =>
    asChild === true && isValidElement(children) ? children : <>{children}</>,
  // The row asks whether the rail is collapsed, to offer its thread flyout.
  useSidebar: () => ({ state: "expanded", isMobile: false }),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <li>{children}</li>
  ),
}));

vi.mock("@/components/ui/sheet", () => ({
  SheetClose: ({
    children,
    asChild,
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) =>
    asChild === true && isValidElement(children) ? children : <>{children}</>,
}));

function renderRow(room: ChatRoom) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ChatRoomSidebarRow
        room={room}
        href={`/chat/rooms/${room.id}`}
        label={room.name ?? room.id}
        isActive={false}
        leading={<span>#</span>}
        onRoomUpdated={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("ChatRoomSidebarRow against the English catalog", () => {
  // The defect SOK-1042 names: the badge announced "1 mentions".
  it("announces one mention in the singular", () => {
    renderRow(makeRoom({ unreadMentionCount: 1 }));

    expect(screen.getByText("1 mention")).toBeInTheDocument();
    expect(screen.queryByText("1 mentions")).toBeNull();
  });

  it("announces several mentions in the plural", () => {
    renderRow(makeRoom({ unreadMentionCount: 4 }));

    expect(screen.getByText("4 mentions")).toBeInTheDocument();
  });

  it("announces one unread message in the singular", () => {
    renderRow(makeRoom({ unreadCount: 1 }));

    expect(screen.getByText("1 unread message")).toBeInTheDocument();
  });

  it("announces several unread messages in the plural", () => {
    renderRow(makeRoom({ unreadCount: 7 }));

    expect(screen.getByText("7 unread messages")).toBeInTheDocument();
  });

  // The collapsed rail's pill is announced through two keys of its own.
  it("names the rail pill's two states from the catalog", () => {
    const { unmount } = renderRow(makeRoom({ unreadMentionCount: 1 }));
    expect(screen.getByText("Mentions you")).toBeInTheDocument();
    unmount();

    renderRow(makeRoom({ unreadCount: 1 }));
    expect(screen.getByText("Unread")).toBeInTheDocument();
  });

  // A row shows one number, so each cap is announced on its own row.
  it("announces a message count past the cap", () => {
    renderRow(makeRoom({ unreadCount: 1234 }));

    expect(
      screen.getByText("More than 99 unread messages"),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="room-unread-count"]'),
    ).toHaveTextContent("99+");
  });

  it("announces a mention count past the cap", () => {
    renderRow(makeRoom({ unreadCount: 1234, unreadMentionCount: 1234 }));

    expect(screen.getByText("More than 99 mentions")).toBeInTheDocument();
    expect(screen.queryByText("More than 99 unread messages")).toBeNull();
  });
});
