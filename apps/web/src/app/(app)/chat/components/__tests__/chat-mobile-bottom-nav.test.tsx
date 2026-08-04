import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openHistorySearchMock = vi.fn();
let mockPathname = "/chat";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/components/history-search-dialog-provider", () => ({
  useHistorySearch: () => ({
    openHistorySearch: openHistorySearchMock,
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

import {
  ChatMobileBottomNav,
  resolveChatMobileActiveTabId,
} from "../chat-mobile-bottom-nav";

describe("resolveChatMobileActiveTabId", () => {
  it("marks Home active for /chat and nested chat routes", () => {
    expect(resolveChatMobileActiveTabId("/chat")).toBe("home");
    expect(resolveChatMobileActiveTabId("/chat/rooms/abc")).toBe("home");
  });

  it("marks History active only on /history", () => {
    expect(resolveChatMobileActiveTabId("/history")).toBe("history");
    expect(resolveChatMobileActiveTabId("/history/extra")).toBeNull();
  });

  it("returns null when no link tab matches", () => {
    expect(resolveChatMobileActiveTabId("/tasks")).toBeNull();
  });
});

describe("ChatMobileBottomNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = "/chat";
  });

  it("calls openHistorySearch when Search is clicked", () => {
    render(<ChatMobileBottomNav />);

    fireEvent.click(screen.getByRole("button", { name: "search" }));

    expect(openHistorySearchMock).toHaveBeenCalledTimes(1);
  });

  it("sets aria-current on the Home link for chat routes", () => {
    mockPathname = "/chat/rooms/1";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "history" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
