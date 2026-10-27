import { render, screen } from "@testing-library/react";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { pathnameRef, relativeTime } = vi.hoisted(() => ({
  pathnameRef: { current: "/" },
  relativeTime: vi.fn(() => "2h ago"),
}));

// Values show up in the text, so a test can tell "Active {time}" got its time.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}(${Object.values(values).join(",")})` : key,
  useFormatter: () => ({ relativeTime }),
  useNow: () => NOW,
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

import { SokoBotStatus } from "@sokosumi/core-client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";

import PersonalAssistantNav, {
  type SidebarSokoBotLive,
} from "./personal-assistant-nav.client";

const NOW = new Date("2026-10-27T12:00:00Z");

const bot: SidebarSokoBotLive = {
  id: "bot-1",
  imageUrl: "https://example.com/1.png",
  seed: "a",
  name: "Mo",
  status: SokoBotStatus.IDLE,
  lastActivityAt: null,
  isYours: true,
};

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
    renderNav();
    const button = screen.getByRole("link", { name: "sokoBot" });

    expect(tokens(button?.className ?? "")).toEqual(
      expect.arrayContaining(["h-11", "md:h-8"]),
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
    renderNav();
    expect(screen.getByRole("link", { name: "sokoBot" })).toHaveAttribute(
      "href",
      SOKO_BOTS_ROUTE,
    );
  });
});

describe("PersonalAssistantNav static entry current destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameRef.current = "/";
  });

  function link() {
    return screen.getByRole("link", { name: "sokoBot" });
  }

  it("marks the row when the reader is on Soko Bots", () => {
    pathnameRef.current = SOKO_BOTS_ROUTE;
    renderNav();
    expect(link()).toHaveAttribute("aria-current", "page");
  });

  it("marks the row from a personal-assistant page too", () => {
    pathnameRef.current = `${SOKO_BOT_ROUTE}/bot-1`;
    renderNav();
    expect(link()).toHaveAttribute("aria-current", "page");
  });

  it("marks nothing on a route it does not own", () => {
    renderNav();
    expect(link()).not.toHaveAttribute("aria-current");
  });
});

/**
 * With the team's bot data the entry is a live two-line row: the bot's face
 * with a status dot, its name, and a line saying what it is doing.
 */
describe("PersonalAssistantNav live Soko Bot row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameRef.current = "/";
  });

  function row(name: RegExp = /Mo/) {
    return screen.getByRole("link", { name });
  }

  it("names the row after the bot", () => {
    renderNav({ bot });
    expect(row()).toHaveTextContent("Mo");
  });

  it("falls back to Soko Bot when the bot has no name", () => {
    renderNav({ bot: { ...bot, name: null } });
    expect(row(/fallbackName/)).toBeInTheDocument();
  });

  it("says a running bot is working now, with a pulsing ring", () => {
    renderNav({ bot: { ...bot, status: SokoBotStatus.RUNNING } });
    expect(row()).toHaveAccessibleName(/workingNow/);
    expect(screen.getByTestId("soko-bot-pulse")).toBeInTheDocument();
  });

  it("holds the pulse still under reduced motion", () => {
    renderNav({ bot: { ...bot, status: SokoBotStatus.RUNNING } });
    const tokens = screen.getByTestId("soko-bot-pulse").className.split(/\s+/);
    // Animated only with motion allowed; no unconditional animation.
    expect(tokens).toContain("motion-safe:animate-ping");
    expect(tokens).not.toContain("animate-ping");
  });

  it.each([
    [SokoBotStatus.PAUSED, /paused/],
    [SokoBotStatus.ERROR, /needsAttention/],
    [SokoBotStatus.IDLE, /ready/],
  ])("gives a %s bot its status line and no pulse", (status, line) => {
    renderNav({ bot: { ...bot, status } });
    expect(row()).toHaveAccessibleName(line);
    expect(screen.queryByTestId("soko-bot-pulse")).toBeNull();
  });

  it("says when an idle bot was last active, in the reader's locale", () => {
    const lastActivityAt = new Date("2026-10-27T10:00:00Z");
    renderNav({ bot: { ...bot, lastActivityAt } });

    expect(row()).toHaveAccessibleName(/activeAgo\(2h ago\)/);
    expect(relativeTime).toHaveBeenCalledWith(lastActivityAt, {
      now: NOW,
      style: "narrow",
    });
  });

  it("opens your own bot", () => {
    renderNav({ bot });
    expect(row()).toHaveAttribute("href", SOKO_BOT_ROUTE);
  });

  it("opens the team's Soko Bots when the bot is a teammate's", () => {
    renderNav({ bot: { ...bot, isYours: false } });
    expect(row()).toHaveAttribute("href", SOKO_BOTS_ROUTE);
  });

  it("marks the row while its bot is open", () => {
    pathnameRef.current = SOKO_BOT_ROUTE;
    renderNav({ bot });
    expect(row()).toHaveAttribute("aria-current", "page");
  });

  it("does not mark your bot's row on the team page", () => {
    pathnameRef.current = SOKO_BOTS_ROUTE;
    renderNav({ bot });
    expect(row()).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "team" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks a teammate's row on the team page", () => {
    pathnameRef.current = SOKO_BOTS_ROUTE;
    renderNav({ bot: { ...bot, isYours: false } });
    expect(row()).toHaveAttribute("aria-current", "page");
  });

  it("offers the team's Soko Bots from a people icon at the end", () => {
    renderNav({ bot });
    expect(screen.getByRole("link", { name: "team" })).toHaveAttribute(
      "href",
      SOKO_BOTS_ROUTE,
    );
  });

  it("covers both lines with one pressable row", () => {
    renderNav({ bot });
    const tokens = row().className.split(/\s+/);
    expect(row()).toHaveAttribute("data-slot", "sidebar-menu-button");
    expect(tokens).toEqual(expect.arrayContaining(["h-auto", "md:min-h-8"]));
  });
});
