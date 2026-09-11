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

vi.mock("@/components/ui/sidebar", () => ({
  SidebarMenuButton: ({
    children,
    asChild,
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) =>
    asChild === true && isValidElement(children) ? children : <>{children}</>,
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

  it("announces both numbers past the shared cap", () => {
    renderRow(makeRoom({ unreadCount: 1234, unreadMentionCount: 1234 }));

    expect(
      screen.getByText("More than 99 unread messages"),
    ).toBeInTheDocument();
    expect(screen.getByText("More than 99 mentions")).toBeInTheDocument();
    expect(screen.getByText("· 99+")).toHaveAttribute("aria-hidden", "true");
  });
});
