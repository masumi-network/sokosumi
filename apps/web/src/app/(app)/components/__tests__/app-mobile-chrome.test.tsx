import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat";
let mockSearchParams = new URLSearchParams();
let mockIsApple = false;

// The bottom chrome and its chat nav call useSession. The real better-auth
// session atom schedules a nanostores unmount timer that can fire after
// happy-dom tears down `window`.
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({
    push: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => {
    if (namespace === "App" && key === "Metadata.Title.template") {
      return "Sokosumi - %s";
    }
    if (namespace === "App" && key === "Channels.Metadata.title") {
      return "Chat";
    }
    return key;
  },
}));

vi.mock("@/app/components/history-search-dialog-provider", () => ({
  useOptionalHistorySearch: () => ({
    openHistorySearch: vi.fn(),
    searchShortcutLabel: "Ctrl+K",
  }),
}));

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => mockIsApple,
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

import {
  CHAT_MOBILE_TAB_BAR_CLEARANCE,
  CHAT_MOBILE_TAB_BAR_CLEARANCE_APPLE,
} from "@/app/chat/components/chat-mobile-tab-registry";

import { AppMobileChrome } from "../app-mobile-chrome.client";

function getTabBarSpacer(container: HTMLElement): Element | null {
  return container.querySelector("[data-mobile-bottom-nav-spacer]");
}

describe("AppMobileChrome", () => {
  beforeEach(() => {
    mockPathname = "/chat";
    mockSearchParams = new URLSearchParams();
    mockIsApple = false;
  });

  it("renders bottom nav and tab-bar clearance spacer on chat home without FAB", () => {
    const { container } = render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "openFab" })).toBeNull();
    const spacer = getTabBarSpacer(container);
    expect(spacer?.className).toContain(CHAT_MOBILE_TAB_BAR_CLEARANCE);
  });

  it("uses Apple float clearance on Apple platforms", () => {
    mockIsApple = true;
    const { container } = render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    const spacer = getTabBarSpacer(container);
    expect(spacer?.className).toContain(CHAT_MOBILE_TAB_BAR_CLEARANCE_APPLE);
    expect(spacer?.className).not.toContain(CHAT_MOBILE_TAB_BAR_CLEARANCE);
  });

  it("keeps the bottom nav on /chat and renders no FAB", () => {
    mockPathname = "/chat";

    const { container } = render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "openFab" })).toBeNull();
    expect(getTabBarSpacer(container)?.className).toContain(
      CHAT_MOBILE_TAB_BAR_CLEARANCE,
    );
  });

  it("shows bottom nav without create FAB on main hub list routes", () => {
    mockPathname = "/tasks";

    const { container } = render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "openFab" })).toBeNull();
    expect(getTabBarSpacer(container)?.className).toContain(
      CHAT_MOBILE_TAB_BAR_CLEARANCE,
    );
  });

  it("hides bottom nav and clearance on room surface", () => {
    mockPathname = "/chat/rooms/room-1";

    const { container } = render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.queryByRole("navigation", { name: "ariaLabel" })).toBeNull();
    expect(getTabBarSpacer(container)).toBeNull();
  });

  it("keeps bottom nav on leftover compose queries on the chats list", () => {
    mockPathname = "/chat";
    mockSearchParams = new URLSearchParams("dm=new");

    const { container } = render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
    expect(getTabBarSpacer(container)).toBeTruthy();
  });

  it("hides bottom nav on nested detail routes", () => {
    mockPathname = "/agents/agent-1";

    render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.queryByRole("navigation", { name: "ariaLabel" })).toBeNull();
  });

  it("hides bottom nav on You submenu stacks", () => {
    mockPathname = "/you/developer";

    render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.queryByRole("navigation", { name: "ariaLabel" })).toBeNull();
  });

  it("keeps bottom nav on bare /chat home", () => {
    mockPathname = "/chat";

    render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
  });
  it("retains the chat title across rooms and releases it on other sections", async () => {
    mockPathname = "/chat/rooms/room-1";
    const { rerender } = render(<AppMobileChrome>child</AppMobileChrome>);
    expect(document.title).toBe("Sokosumi - Chat");

    await act(async () => {
      document.title = "Sokosumi - Marketplace for human-to-agent interactions";
      await Promise.resolve();
    });
    mockPathname = "/chat/rooms/room-2";
    rerender(<AppMobileChrome>child</AppMobileChrome>);
    expect(document.title).toBe("Sokosumi - Chat");

    mockPathname = "/tasks";
    rerender(<AppMobileChrome>child</AppMobileChrome>);
    await act(async () => {
      document.title = "Sokosumi - Tasks";
      await Promise.resolve();
    });
    expect(document.title).toBe("Sokosumi - Tasks");
  });
});
