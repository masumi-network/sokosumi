import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat";
let mockIsApple = false;

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
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

describe("AppMobileChrome", () => {
  beforeEach(() => {
    mockPathname = "/chat";
    mockIsApple = false;
  });

  it("renders bottom nav and tab-bar clearance on chat home", () => {
    const { container } = render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
    const wrapper = container.firstElementChild?.firstElementChild;
    expect(wrapper?.className).toContain(CHAT_MOBILE_TAB_BAR_CLEARANCE);
  });

  it("uses Apple float clearance on Apple platforms", () => {
    mockIsApple = true;
    const { container } = render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    const wrapper = container.firstElementChild?.firstElementChild;
    expect(wrapper?.className).toContain(CHAT_MOBILE_TAB_BAR_CLEARANCE_APPLE);
    expect(wrapper?.className).not.toContain(CHAT_MOBILE_TAB_BAR_CLEARANCE);
  });

  it("keeps bottom nav on /chat/chats", () => {
    mockPathname = "/chat/chats";

    render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
  });

  it("shows bottom nav on main hub list routes", () => {
    mockPathname = "/tasks";

    render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
  });

  it("hides bottom nav and clearance on room surface", () => {
    mockPathname = "/chat/rooms/room-1";

    const { container } = render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.queryByRole("navigation", { name: "ariaLabel" })).toBeNull();
    const wrapper = container.firstElementChild?.firstElementChild;
    expect(wrapper?.className).not.toContain(CHAT_MOBILE_TAB_BAR_CLEARANCE);
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

  it("keeps bottom nav on /chat (drafts share this path)", () => {
    mockPathname = "/chat";

    render(
      <AppMobileChrome>
        <div>child</div>
      </AppMobileChrome>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
  });
});
