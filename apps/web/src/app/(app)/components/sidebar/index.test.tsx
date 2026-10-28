import { render, screen, within } from "@testing-library/react";
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
vi.mock(
  "@/app/components/sidebar/components/sidebar-search-button.client",
  () => ({
    SidebarSearchButton: () => <button type="button">search</button>,
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
  // As in Linear: the switcher at the start, Search and New task pushed to
  // the end.
  it("leads with the Workspace switcher, then Search, then New task", () => {
    const { container } = renderSidebar();
    const header = sidebarHeader(container);

    const switcher = within(header).getByRole("button", { name: "Acme" });
    const search = within(header).getByRole("button", { name: "search" });
    const newTask = within(header).getByRole("button", { name: "newTask" });

    expect(follows(switcher, search)).toBe(true);
    expect(follows(search, newTask)).toBe(true);
    // The switcher's slot takes the room the buttons leave, so they sit at
    // the end and its name shortens before it reaches them.
    expect(tokens(switcher.parentElement)).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1"]),
    );
    expect(switcher.parentElement?.contains(search)).toBe(false);
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

function follows(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("Sidebar project scope", () => {
  it("titles the nav with the project scope, directly under Soko Bot", () => {
    renderSidebar();

    const sokoBot = screen.getByRole("link", { name: "sokoBot" });
    const title = screen.getByRole("button", { name: "projectTitle" });
    const nav = screen.getByRole("navigation", { name: "menuItems" });

    expect(follows(sokoBot, title)).toBe(true);
    expect(follows(title, nav)).toBe(true);
  });

  // Work, Records and Marketing read as inside the project; the chat
  // sections are the workspace's, so they sit outside the line.
  it("ties the nav groups to the title with a line, and leaves chat outside it", () => {
    renderSidebar();

    const scoped = screen.getByRole("navigation", {
      name: "menuItems",
    }).parentElement;
    const chatList = screen.getByRole("navigation", { name: "chatList" });

    expect(tokens(scoped)).toEqual(
      expect.arrayContaining(["max-md:border-s", "border-sidebar-border"]),
    );
    expect(scoped?.contains(chatList)).toBe(false);
    expect(
      scoped?.contains(screen.getByRole("button", { name: "projectTitle" })),
    ).toBe(false);
  });

  // The chat area is headed like the nav groups (its Chats heading lives in
  // the list), so no rule cuts the sidebar in two between them.
  it("runs the nav straight into the chat area, with no rule between", () => {
    const { container } = renderSidebar();
    const scoped = screen.getByRole("navigation", {
      name: "menuItems",
    }).parentElement;
    const chatList = screen.getByRole("navigation", { name: "chatList" });

    expect(
      container.querySelector(
        '[data-slot="sidebar-content"] [data-slot="sidebar-separator"]',
      ),
    ).toBeNull();
    expect(scoped?.nextElementSibling).toBe(chatList);
  });
});
