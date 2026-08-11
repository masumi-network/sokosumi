import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat";
let mockSearchParams = new URLSearchParams();
let mockIsApple = false;

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({
    push: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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

  it("keeps bottom nav and onboarding FAB on /chat/chats", () => {
    mockPathname = "/chat/chats";

    render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "openFab" })).toHaveAttribute(
      "href",
      "/chat?welcome=1",
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

  it("hides bottom nav and clearance on draft DM compose", () => {
    mockPathname = "/chat";
    mockSearchParams = new URLSearchParams("dm=new");

    const { container } = render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.queryByRole("navigation", { name: "ariaLabel" })).toBeNull();
    expect(getTabBarSpacer(container)).toBeNull();
    expect(screen.queryByRole("link", { name: "openFab" })).toBeNull();
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

  it("keeps bottom nav on bare /chat home", () => {
    mockPathname = "/chat";

    render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
  });
});
