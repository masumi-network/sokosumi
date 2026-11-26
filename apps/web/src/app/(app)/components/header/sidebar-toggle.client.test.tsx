import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let isMobile = false;
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

vi.mock("@/hooks/effects/use-mobile", () => ({
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

  it("opens the contextual drawer on mobile", () => {
    isMobile = true;
    renderToggle();

    const toggle = screen.getByRole("button", { name: "Show sidebar" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAccessibleName("Hide sidebar");
  });
});
