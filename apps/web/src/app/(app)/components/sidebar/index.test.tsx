import { render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/use-mobile", () => ({
  MOBILE_BREAKPOINT: 768,
  useIsMobile: () => false,
}));

// The sidebar's own regions, each tested at its own seam. Here only where
// they sit matters.
vi.mock("@/app/components/sidebar/components/personal-assistant-nav", () => ({
  default: () => <a href="/personal-assistant">sokoBot</a>,
}));
vi.mock("@/app/components/project-scope/sidebar-project-scope", () => ({
  SidebarProjectScope: () => <button type="button">projectTitle</button>,
}));
vi.mock("@/app/components/sidebar/components/menu-items", () => ({
  default: () => <nav aria-label="menuItems" />,
}));
vi.mock("@/app/components/sidebar/components/announcement-cards", () => ({
  default: () => null,
}));
vi.mock(
  "@/app/components/sidebar/components/sidebar-new-task-button.client",
  () => ({
    SidebarNewTaskButton: () => <button type="button">newTask</button>,
  }),
);

import Sidebar from "@/app/components/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

function tokens(element: Element | null | undefined): string[] {
  return (element?.className ?? "").split(/\s+/).filter(Boolean);
}

function renderSidebar() {
  return render(
    <SidebarProvider defaultOpen>
      <Sidebar
        workspaceSwitcher={<button type="button">Acme</button>}
        accountFooter={<div>account</div>}
        chatList={<nav aria-label="chatList" />}
        socialBetaEnabled={false}
        newsletterEnabled={false}
      />
    </SidebarProvider>,
  );
}

function sidebarHeader(container: HTMLElement): HTMLElement {
  const header = container.querySelector<HTMLElement>(
    '[data-slot="sidebar-header"]',
  );
  if (!header) throw new Error("no sidebar header");
  return header;
}

describe("Sidebar header", () => {
  it("fills the row with the Workspace switcher, then New task", () => {
    const { container } = renderSidebar();
    const header = sidebarHeader(container);

    const switcher = within(header).getByRole("button", { name: "Acme" });
    const newTask = within(header).getByRole("button", { name: "newTask" });

    expect(
      switcher.compareDocumentPosition(newTask) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // It takes the room New task leaves, and shortens its name inside it.
    expect(tokens(switcher.parentElement)).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1"]),
    );
    // The same 64px row as the top bar, so the hairline runs straight across.
    expect(tokens(header)).toEqual(
      expect.arrayContaining(["h-16", "border-b"]),
    );
  });

  // The phone keeps its switcher in the top bar, and its sheet is unchanged.
  it("leaves the wordmark to the phone sheet, and the switcher to desktop", () => {
    const { container } = renderSidebar();
    const header = sidebarHeader(container);

    const switcher = within(header).getByRole("button", { name: "Acme" });
    const wordmark = within(header).getByRole("link");

    expect(wordmark).toHaveAttribute("href", "/");
    expect(tokens(wordmark.parentElement)).toContain("md:hidden");
    expect(tokens(switcher.parentElement)).toContain("max-md:hidden");
  });
});
