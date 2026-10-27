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
 * Soko Bots is an ordinary Sidebar row (GLOSSARY.md), not the 48px bordered
 * card it used to be: it takes the row primitive's height and the shared slot.
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
      expect.arrayContaining(["h-11", "md:h-7"]),
    );
    // The card that is gone: its own border and radius.
    expect(tokens(button?.className ?? "")).not.toContain("border");
    expect(tokens(button?.className ?? "")).not.toContain("rounded-lg");
  });

  it("shows one 20px face in the shared slot", () => {
    const { container } = renderNav({ bot });
    const slot = container.querySelector('[data-slot="sidebar-row-slot"]');
    const face = slot?.querySelector("img");

    expect(slot).not.toBeNull();
    expect(tokens(slot?.className ?? "")).toContain("min-w-6");
    expect(face).not.toBeNull();
    expect(tokens(face?.className ?? "")).toContain("size-5");
  });

  it("falls back to the bot icon in the same slot when there is no bot", () => {
    const { container } = renderNav();
    const slot = container.querySelector('[data-slot="sidebar-row-slot"]');

    expect(slot).not.toBeNull();
    expect(slot?.querySelector("img")).toBeNull();
    expect(slot?.querySelector("svg")).not.toBeNull();
  });

  it("links the named row to the team's Soko Bots", () => {
    renderNav({ bot });
    expect(screen.getByRole("link", { name: "sokoBot" })).toHaveAttribute(
      "href",
      SOKO_BOTS_ROUTE,
    );
  });
});

describe("PersonalAssistantNav current destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameRef.current = "/";
  });

  function link() {
    return screen.getByRole("link", { name: "sokoBot" });
  }

  it("marks the row when the reader is on Soko Bots", () => {
    pathnameRef.current = SOKO_BOTS_ROUTE;
    renderNav({ bot });
    expect(link()).toHaveAttribute("aria-current", "page");
  });

  it("marks the row from a personal-assistant page too", () => {
    pathnameRef.current = `${SOKO_BOT_ROUTE}/bot-1`;
    renderNav({ bot });
    expect(link()).toHaveAttribute("aria-current", "page");
  });

  it("marks nothing on a route it does not own", () => {
    renderNav({ bot });
    expect(link()).not.toHaveAttribute("aria-current");
  });
});
