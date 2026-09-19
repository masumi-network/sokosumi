import { render, screen } from "@testing-library/react";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const { pathnameRef } = vi.hoisted(() => ({
  pathnameRef: { current: "/" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
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

// Radix `Slot` hands the button's props to its immediate child, which is this
// one, so a mock that drops them would take the row's whole class list with it.
vi.mock("@/components/ui/sheet", () => ({
  SheetClose: ({
    children,
    asChild: _asChild,
    ...props
  }: {
    children: ReactNode;
    asChild?: boolean;
  }) =>
    isValidElement(children) ? cloneElement(children, props) : <>{children}</>,
}));

vi.mock("@/components/chat/personal-assistant-chrome-store", () => ({
  publishPersonalAssistantChromeVisible: vi.fn(),
}));

vi.mock("@/components/aurora-orb", () => ({
  AuroraOrb: ({ className }: { className?: string }) => (
    <span data-testid="aurora-orb" className={className} />
  ),
}));

import { SidebarProvider } from "@/components/ui/sidebar";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";

import PersonalAssistantNav from "./personal-assistant-nav.client";

const bot = { id: "bot-1", imageUrl: "https://example.com/1.png", seed: "a" };

function tokens(className: string): string[] {
  return className.split(/\s+/).filter(Boolean);
}

function renderNav(props: Parameters<typeof PersonalAssistantNav>[0] = {}) {
  return render(
    <SidebarProvider defaultOpen>
      <PersonalAssistantNav {...props} />
    </SidebarProvider>,
  );
}

/**
 * Soko Bots is an ordinary Sidebar row (CONTEXT.md), not the 48px bordered
 * card it used to be: it takes the row primitive's height and the shared slot,
 * so it neither pushes the list down nor resizes its mark when the sidebar
 * toggles.
 */
describe("PersonalAssistantNav as an ordinary Sidebar row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameRef.current = "/";
  });

  it("takes the row primitive's height rather than a card's", () => {
    renderNav({ bot });
    const button = screen.getByRole("link", { name: "sokoBot" });

    expect(tokens(button?.className ?? "")).toEqual(
      expect.arrayContaining(["h-11", "md:h-8"]),
    );
    // The card that is gone: its own border, radius and rail hover exception.
    expect(tokens(button?.className ?? "")).not.toContain("border");
    expect(tokens(button?.className ?? "")).not.toContain("rounded-lg");
    expect(button?.className).not.toContain(
      "group-data-[collapsible=icon]:hover:ring-0!",
    );
  });

  it("shows one 24px face in the shared slot, the same in both states", () => {
    const { container } = renderNav({ bot });
    const slot = container.querySelector('[data-slot="sidebar-row-slot"]');
    const face = slot?.querySelector("img");

    expect(slot).not.toBeNull();
    expect(tokens(slot?.className ?? "")).toContain("min-w-6");
    expect(face).not.toBeNull();
    expect(tokens(face?.className ?? "")).toContain("size-6");
    // No state-dependent size: the face cannot resize on a toggle.
    expect(face?.className).not.toContain("group-data-[collapsible=icon]:");
  });

  it("falls back to the bot icon in the same slot when there is no bot", () => {
    const { container } = renderNav();
    const slot = container.querySelector('[data-slot="sidebar-row-slot"]');

    expect(slot).not.toBeNull();
    expect(slot?.querySelector("img")).toBeNull();
    expect(slot?.querySelector("svg")).not.toBeNull();
  });

  it("names the row on the sidebar button so the collapsed rail can show it", () => {
    renderNav({ bot });
    expect(screen.getByRole("link", { name: "sokoBot" })).toHaveAttribute(
      "href",
      SOKO_BOTS_ROUTE,
    );
  });

  it("keeps the label in the accessibility tree when the rail collapses", () => {
    renderNav({ bot });
    const label = screen.getByText("sokoBot");
    expect(tokens(label.className)).toContain(
      "group-data-[collapsible=icon]:max-w-0",
    );
    expect(tokens(label.className)).not.toContain(
      "group-data-[collapsible=icon]:sr-only",
    );
    expect(tokens(label.className)).not.toContain(
      "group-data-[collapsible=icon]:hidden",
    );
  });
});

// Collapsed, the rail's fill belongs to hover alone. This row is on that
// rail too, so the open destination is the same right-edge mark Chat and
// nav already use.
describe("PersonalAssistantNav rail selection bar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameRef.current = "/";
  });

  function railSelection(container: HTMLElement) {
    return container.querySelector('[data-slot="sidebar-rail-selection"]');
  }

  it("marks the row when the reader is on Soko Bots", () => {
    pathnameRef.current = SOKO_BOTS_ROUTE;
    expect(railSelection(renderNav({ bot }).container)).not.toBeNull();
  });

  it("marks the row from a personal-assistant page too", () => {
    pathnameRef.current = `${SOKO_BOT_ROUTE}/bot-1`;
    expect(railSelection(renderNav({ bot }).container)).not.toBeNull();
  });

  it("shows no selection mark on a route it does not own", () => {
    expect(railSelection(renderNav({ bot }).container)).toBeNull();
  });
});
