vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ prefetch: vi.fn() }),
}));
vi.mock("@/app/components/sidebar/components/global-rail.client", () => ({
  GlobalRail: () => null,
}));

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

vi.mock("@/hooks/effects/use-mobile", () => ({
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

function renderSidebar(path = "/agents") {
  pathname = path;
  return render(
    <SidebarProvider defaultOpen>
      <Sidebar
        workspaceSwitcher={<button type="button">Workspace</button>}
        accountFooter={<div>account</div>}
        chatList={<nav aria-label="chatList" />}
        newsletterEnabled={false}
      />
    </SidebarProvider>,
  );
}

describe("Sidebar project scope", () => {
  it("shows project scope above the Work links and hides Chats", () => {
    renderSidebar();

    expect(screen.queryByRole("link", { name: "sokoBot" })).toBeNull();
    const title = screen.getByRole("button", { name: "projectTitle" });
    const nav = screen.getByRole("navigation", { name: "menuItems" });

    expect(
      title.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Work, Records and Marketing read as inside the project; the chat
  // sections are the workspace's, so they sit outside the line.
  it("ties the nav groups to the title with a line, and leaves chat outside it", () => {
    renderSidebar();

    const scoped = screen.getByRole("navigation", {
      name: "menuItems",
    }).parentElement;
    const chatList = document.querySelector('[aria-label="chatList"]');

    expect(tokens(scoped)).toEqual(
      expect.arrayContaining(["max-md:border-s", "border-sidebar-border"]),
    );
    expect(scoped?.contains(chatList)).toBe(false);
    expect(
      scoped?.contains(screen.getByRole("button", { name: "projectTitle" })),
    ).toBe(false);
  });

  it("shows the chat list in Chats", () => {
    renderSidebar("/chat/example");

    expect(screen.getByRole("navigation", { name: "chatList" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "menuItems" })).toBeNull();
  });
});

it("places workspace selection above the phone drawer panels", () => {
  const { container } = renderSidebar();
  const row = container.querySelector('[data-slot="sidebar-workspace-row"]');
  const panel = container.querySelector("#app-sidebar-panel");
  expect(row).toHaveClass("md:hidden", "h-12");
  expect(row).toHaveTextContent("Workspace");
  expect(
    panel &&
      row &&
      row.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
