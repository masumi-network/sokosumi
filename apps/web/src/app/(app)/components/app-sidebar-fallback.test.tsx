import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/agents",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

import { AppSidebarFallback } from "@/app/components/app-sidebar-fallback";
import { SidebarProvider } from "@/components/ui/sidebar";

function tokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

function renderFallback() {
  return render(
    <SidebarProvider defaultOpen>
      <AppSidebarFallback />
    </SidebarProvider>,
  );
}

/**
 * The boot shell's nav is the real `MenuItems`, not a placeholder for it, so
 * nothing in it moves when the streamed sidebar replaces this frame. A
 * regression here is silent — the shell would still render, just blank again
 * — so the links are asserted rather than the markup around them.
 */
describe("AppSidebarFallback", () => {
  it("renders the real nav links rather than placeholders", () => {
    renderFallback();

    // `/drive` is desktop-only, and `use-mobile` is mocked to desktop above.
    for (const href of [
      "/agents",
      "/projects",
      "/tasks",
      "/drive",
      "/history",
    ]) {
      expect(
        screen.getByRole("link", {
          name: (_, element) => element.getAttribute("href") === href,
        }),
      ).toBeInTheDocument();
    }
  });

  it("leaves the session-backed surfaces as placeholders", () => {
    const { container } = renderFallback();

    const roomList = container.querySelector(
      '[data-slot="sidebar-group"][aria-hidden]',
    );
    const rows =
      roomList?.querySelectorAll('[data-slot="sidebar-menu-item"]') ?? [];

    // Each row is a leading mark plus a name, under a section header that is
    // its own chevron and label — derived from the rows so adding one does
    // not mean editing a total here.
    expect(rows.length).toBeGreaterThan(0);
    expect(roomList?.querySelectorAll('[data-slot="skeleton"]').length).toBe(
      rows.length * 2 + 2,
    );

    // The account chip: an avatar over name and plan lines.
    expect(
      container
        .querySelector('[data-slot="sidebar-footer"]')
        ?.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBe(3);
  });

  it("keeps both logo states in the DOM so a collapsed boot script can hide the wordmark", () => {
    const { container } = render(
      <SidebarProvider defaultOpen={false}>
        <AppSidebarFallback />
      </SidebarProvider>,
    );

    expect(container.querySelector('a[href="/"]')).not.toBeNull();
    const expand = container.querySelector(
      'button[aria-label="expandSidebar"]',
    );
    expect(expand).not.toBeNull();
    expect(tokens(expand?.className ?? "")).toEqual(
      expect.arrayContaining([
        "hidden",
        "group-data-[collapsible=icon]:md:flex",
      ]),
    );
    expect(tokens(expand?.className ?? "")).not.toContain("md:flex");
  });

  it("gives the room skeleton the rail's collapsed geometry", () => {
    const { container } = renderFallback();
    const skeleton = container.querySelector(
      '[data-slot="sidebar-group"][aria-hidden]',
    );
    const header = skeleton?.querySelector(
      '[data-slot="sidebar-group-content"] > div',
    );
    const row = skeleton?.querySelector(
      '[data-slot="sidebar-menu-item"] > div',
    );
    const mark = row?.querySelector('[data-slot="sidebar-row-slot"]');

    // The section header stays on the rail as one 32px square, on the same
    // 28px leading axis (`ml-1`) every real row uses there.
    expect(tokens(header?.className ?? "")).toEqual(
      expect.arrayContaining([
        "md:h-8",
        "group-data-[collapsible=icon]:w-8!",
        "group-data-[collapsible=icon]:ml-1",
        "group-data-[collapsible=icon]:justify-center",
      ]),
    );
    expect(tokens(header?.className ?? "")).not.toContain(
      "group-data-[collapsible=icon]:hidden",
    );
    // A Sidebar row's height: one rule for both states, so nothing under the
    // skeleton moves when the real list arrives or the sidebar toggles.
    expect(tokens(row?.className ?? "")).toEqual(
      expect.arrayContaining([
        "h-11",
        "md:h-8",
        "px-2",
        "gap-2",
        "group-data-[collapsible=icon]:w-8!",
        "group-data-[collapsible=icon]:ml-1",
        "group-data-[collapsible=icon]:justify-center",
        "group-data-[collapsible=icon]:px-0",
      ]),
    );
    // The mark sits in the shared slot at one size, like every real row's.
    expect(mark?.getAttribute("data-slot")).toBe("sidebar-row-slot");
    expect(tokens(mark?.className ?? "")).toContain("size-6");
  });
});
