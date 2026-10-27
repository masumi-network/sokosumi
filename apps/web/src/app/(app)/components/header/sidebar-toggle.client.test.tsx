import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let isMobile = false;
const presence = vi.fn(() => ({ showUnreadDot: false, unreadRoomCount: 0 }));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => isMobile,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    ({
      show: "Show sidebar",
      hide: "Hide sidebar",
      unreadChats: "Unread chats",
    })[key] ?? key,
}));

vi.mock("@/app/chat/components/use-chat-tab-unread-presence", () => ({
  useChatTabUnreadPresence: () => presence(),
}));

import { SidebarProvider } from "@/components/ui/sidebar";

import { SidebarToggle } from "./sidebar-toggle.client";

function renderToggle({ open = true }: { open?: boolean } = {}) {
  return render(
    <SidebarProvider defaultOpen={open}>
      <SidebarToggle />
    </SidebarProvider>,
  );
}

describe("SidebarToggle", () => {
  beforeEach(() => {
    isMobile = false;
    presence.mockReset();
    presence.mockReturnValue({ showUnreadDot: false, unreadRoomCount: 0 });
    document.cookie =
      "sidebar_state=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("hides an open sidebar and says so", () => {
    renderToggle();

    const toggle = screen.getByRole("button", { name: "Hide sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);

    const shown = screen.getByRole("button", { name: "Show sidebar" });
    expect(shown).toHaveAttribute("aria-expanded", "false");
  });

  it("follows ⌘B / Ctrl+B", () => {
    renderToggle();

    act(() => {
      fireEvent.keyDown(window, { key: "b", metaKey: true });
    });
    expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy();

    act(() => {
      fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    });
    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
  });

  it("carries the unread dot while the sidebar is hidden and a chat is unread", () => {
    presence.mockReturnValue({ showUnreadDot: true, unreadRoomCount: 2 });
    renderToggle({ open: false });

    const toggle = screen.getByRole("button", { name: "Show sidebar" });
    expect(toggle).toHaveAccessibleDescription("Unread chats");
  });

  it("shows no dot while hidden with nothing unread", () => {
    renderToggle({ open: false });

    expect(
      screen.getByRole("button", { name: "Show sidebar" }),
    ).not.toHaveTextContent("Unread chats");
  });

  it("does not read unread presence while the sidebar is open", () => {
    presence.mockReturnValue({ showUnreadDot: true, unreadRoomCount: 2 });
    renderToggle();

    expect(
      screen.getByRole("button", { name: "Hide sidebar" }),
    ).not.toHaveTextContent("Unread chats");
    expect(presence).not.toHaveBeenCalled();
  });

  it("shows what it does and its shortcut in a tooltip on keyboard focus", async () => {
    renderToggle();
    const toggle = screen.getByRole("button", { name: "Hide sidebar" });

    // A native `title` shows only under a pointer; the tooltip also answers
    // focus. The shortcut sits in a key cap after the label, as search's does.
    expect(toggle).not.toHaveAttribute("title");
    fireEvent.focus(toggle);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Hide sidebar");
    expect(within(tooltip).getByText("Ctrl+B").tagName).toBe("KBD");
  });

  it("is desktop only: the phone opens its sheet elsewhere", () => {
    isMobile = true;
    renderToggle();

    expect(screen.queryByRole("button")).toBeNull();
  });
});
