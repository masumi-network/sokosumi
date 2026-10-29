import { act, fireEvent, render, screen } from "@testing-library/react";
import { cloneElement, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { pathnameRef, relativeTime, reduceMotion } = vi.hoisted(() => ({
  pathnameRef: { current: "/" },
  relativeTime: vi.fn(() => "2h ago"),
  reduceMotion: { current: false },
}));

vi.mock("motion/react", () => ({
  useReducedMotion: () => reduceMotion.current,
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

import { type SokoBotAvatarView, SokoBotStatus } from "@sokosumi/core-client";
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
  avatarState: "idle",
  avatar: null,
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

  // The pill sweep is the only persistent busy signal: the row never pulses.
  it("does not pulse a working bot's face", () => {
    const { container } = renderNav({
      bot: { ...bot, status: SokoBotStatus.RUNNING, avatarState: "working" },
    });
    expect(container.querySelector('[class*="animate-ping"]')).toBeNull();
  });

  it.each([
    ["thinking", /label\.thinking/, "status-working"],
    ["working", /label\.working/, "status-working"],
    ["done", /label\.done/, "semantic-success"],
    ["needs_you", /label\.needs_you/, "semantic-warning"],
    ["offline", /label\.offline/, "muted-foreground"],
    ["idle", /ready/, "muted-foreground"],
  ] as const)(
    "says a %s bot's state in its line and paints the dot and line to match",
    (avatarState, line, hue) => {
      const { container } = renderNav({ bot: { ...bot, avatarState } });

      expect(row()).toHaveAccessibleName(line);
      expect(
        container.querySelector('[data-slot="soko-bot-status-dot"]'),
      ).toHaveClass(`bg-${hue}`);
      expect(
        container.querySelector('[data-slot="soko-bot-status-line"]')
          ?.className,
      ).toMatch(new RegExp(`\\btext-${hue}(-label)?\\b`));
    },
  );

  it("keeps a failed idle bot's error in the row", () => {
    const { container } = renderNav({
      bot: { ...bot, status: SokoBotStatus.ERROR },
    });

    expect(row()).toHaveAccessibleName(/needsAttention/);
    expect(
      container.querySelector('[data-slot="soko-bot-status-dot"]'),
    ).toHaveClass("bg-semantic-destructive");
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
    // It releases the height and keeps the primitive's floor; it names no
    // row height of its own.
    expect(tokens).toEqual(
      expect.arrayContaining(["h-auto", "md:h-auto", "min-h-11", "md:min-h-7"]),
    );
    expect(tokens).not.toContain("md:min-h-8");
  });
});

const NO_STATES = {
  idle: null,
  thinking: null,
  working: null,
  done: null,
  needs_you: null,
  offline: null,
};

function stateAssets(name: string) {
  return {
    stillUrl: `https://blob/${name}.png`,
    loopUrl: `https://blob/${name}-480.mp4`,
    loopLargeUrl: `https://blob/${name}-960.mp4`,
  };
}

const CRAFTED: SokoBotAvatarView = {
  styleId: "crafted-desk",
  styleVersion: 1,
  stillUrl: "https://blob/idle.png",
  states: {
    ...NO_STATES,
    idle: stateAssets("idle"),
    working: stateAssets("working"),
    done: stateAssets("done"),
  },
};

const craftedBot: SidebarSokoBotLive = {
  ...bot,
  imageUrl: CRAFTED.stillUrl,
  avatar: CRAFTED,
};

function reducedMotion(matches: boolean) {
  reduceMotion.current = matches;
}

function rowFace(container: HTMLElement) {
  return container.querySelector('[data-slot="sidebar-row-slot"] img');
}

function rowLoop(container: HTMLElement) {
  return container.querySelector('[data-slot="sidebar-row-slot"] video');
}

describe("PersonalAssistantNav crafted avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    pathnameRef.current = "/";
    reducedMotion(false);
    // No media playback in the test DOM: a loop is a video that never plays.
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    reduceMotion.current = false;
  });

  it("crops a crafted avatar to the creature's face", () => {
    const { container } = renderNav({ bot: craftedBot });
    const face = rowFace(container);

    expect(face).toHaveAttribute("src", "https://blob/idle.png");
    expect(tokens(face?.className ?? "")).toEqual(
      expect.arrayContaining(["-left-[89%]", "-top-[51%]", "size-[240%]"]),
    );
    expect(face?.parentElement?.className).toContain("overflow-hidden");
  });

  it("rests on the still on mount and plays once when the state changes", () => {
    const view = renderNav({ bot: craftedBot });
    expect(rowLoop(view.container)).toBeNull();
    expect(rowFace(view.container)).toHaveAttribute(
      "src",
      "https://blob/idle.png",
    );

    view.rerender(
      <SidebarProvider defaultOpen>
        <PersonalAssistantNav bot={{ ...craftedBot, avatarState: "working" }} />
      </SidebarProvider>,
    );
    const video = rowLoop(view.container);
    expect(video).toHaveAttribute("src", "https://blob/working-480.mp4");
    expect(video).toHaveAttribute("poster", "https://blob/working.png");
    expect(video).not.toHaveAttribute("loop");
    // The same face crop as the still.
    expect(tokens(video?.className ?? "")).toEqual(
      expect.arrayContaining(["-left-[89%]", "-top-[51%]", "size-[240%]"]),
    );

    fireEvent.ended(video as HTMLVideoElement);
    expect(rowLoop(view.container)).toBeNull();
    expect(rowFace(view.container)).toHaveAttribute(
      "src",
      "https://blob/working.png",
    );
  });

  it("keeps the row on the still under reduced motion", () => {
    reducedMotion(true);
    const view = renderNav({ bot: craftedBot });
    view.rerender(
      <SidebarProvider defaultOpen>
        <PersonalAssistantNav bot={{ ...craftedBot, avatarState: "working" }} />
      </SidebarProvider>,
    );
    expect(rowLoop(view.container)).toBeNull();
    expect(rowFace(view.container)).toHaveAttribute(
      "src",
      "https://blob/working.png",
    );
  });

  it("leaves a legacy mascot uncropped and still", () => {
    const mascot: SidebarSokoBotLive = {
      ...bot,
      avatarState: "working",
      avatar: {
        styleId: "mascot",
        styleVersion: 1,
        stillUrl: bot.imageUrl ?? "",
        states: NO_STATES,
      },
    };
    const { container } = renderNav({ bot: mascot });
    const face = rowFace(container);

    expect(face).toHaveAttribute("src", "https://example.com/1.png");
    expect(tokens(face?.className ?? "")).not.toContain("size-[240%]");
  });

  describe("hover card", () => {
    const working: SidebarSokoBotLive = {
      ...craftedBot,
      avatarState: "working",
    };

    function cardImage() {
      return screen.queryByRole("img", { name: "alt(Mo,label.working)" });
    }

    function cardVideo() {
      return document.querySelector(
        '[data-slot="hover-card-content"] video',
      ) as HTMLVideoElement | null;
    }

    function openCard() {
      fireEvent.focus(screen.getByRole("link", { name: /Mo/ }));
      act(() => {
        vi.advanceTimersByTime(300);
      });
    }

    it("is closed until the row is hovered or focused", () => {
      renderNav({ bot: working });
      expect(cardImage()).toBeNull();
    });

    it("opens on keyboard focus with the loop, name, state and line", () => {
      renderNav({ bot: working });
      openCard();

      const video = cardVideo();
      expect(video).toHaveAttribute("src", "https://blob/working-480.mp4");
      expect(video).toHaveAttribute("poster", "https://blob/working.png");
      expect(cardImage()).not.toBeNull();
      expect(
        screen.getByText("label.working", {
          selector: '[data-slot="avatar-state-pill"]',
        }),
      ).toBeInTheDocument();
      expect(screen.getByText("line.working")).toBeInTheDocument();
    });

    it("opens on hover too", () => {
      renderNav({ bot: working });
      fireEvent.pointerEnter(screen.getByRole("link", { name: /Mo/ }), {
        pointerType: "mouse",
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(cardImage()).not.toBeNull();
    });

    it("loops while open, and closing it removes the loop", () => {
      renderNav({ bot: working });
      openCard();
      expect(cardVideo()?.loop).toBe(true);

      fireEvent.blur(screen.getByRole("link", { name: /Mo/ }));
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(cardVideo()).toBeNull();
      expect(cardImage()).toBeNull();
    });

    it("shows the still under reduced motion", () => {
      reducedMotion(true);
      renderNav({ bot: working });
      openCard();
      expect(cardVideo()).toBeNull();
      expect(cardImage()).toHaveAttribute("src", "https://blob/working.png");
    });
  });
});
