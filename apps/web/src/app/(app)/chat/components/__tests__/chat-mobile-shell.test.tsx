import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/components/history-search-dialog-provider", () => ({
  useHistorySearch: () => ({
    openHistorySearch: vi.fn(),
    searchShortcutLabel: "Ctrl+K",
  }),
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

import { ChatMobileShell } from "../chat-mobile-shell";
import { CHAT_MOBILE_TAB_BAR_CLEARANCE } from "../chat-mobile-tab-registry";

describe("ChatMobileShell", () => {
  beforeEach(() => {
    mockPathname = "/chat";
  });

  it("renders bottom nav and tab-bar clearance on chat home", () => {
    const { container } = render(
      <ChatMobileShell>
        <div>child</div>
      </ChatMobileShell>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
    const wrapper = container.firstElementChild?.firstElementChild;
    expect(wrapper?.className).toContain(CHAT_MOBILE_TAB_BAR_CLEARANCE);
  });

  it("keeps bottom nav on /chat/chats", () => {
    mockPathname = "/chat/chats";

    render(
      <ChatMobileShell>
        <div>child</div>
      </ChatMobileShell>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
  });

  it("hides bottom nav and clearance on room surface", () => {
    mockPathname = "/chat/rooms/room-1";

    const { container } = render(
      <ChatMobileShell>
        <div>child</div>
      </ChatMobileShell>,
    );

    expect(screen.queryByRole("navigation", { name: "ariaLabel" })).toBeNull();
    const wrapper = container.firstElementChild?.firstElementChild;
    expect(wrapper?.className).not.toContain(CHAT_MOBILE_TAB_BAR_CLEARANCE);
  });

  it("keeps bottom nav on /chat (drafts share this path)", () => {
    mockPathname = "/chat";

    render(
      <ChatMobileShell>
        <div>child</div>
      </ChatMobileShell>,
    );

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
  });
});
