import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openHistorySearchMock = vi.fn();
let mockPathname = "/chat";
let mockIsApple = false;
let mockHistorySearch: {
  openHistorySearch: typeof openHistorySearchMock;
  searchShortcutLabel: string;
} | null = {
  openHistorySearch: openHistorySearchMock,
  searchShortcutLabel: "Ctrl+K",
};

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/app/components/history-search-dialog-provider", () => ({
  useOptionalHistorySearch: () => mockHistorySearch,
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
  ChatMobileBottomNav,
  resolveChatMobileActiveTabId,
} from "../chat-mobile-bottom-nav";

describe("resolveChatMobileActiveTabId", () => {
  it("marks Home active only for exact /chat", () => {
    expect(resolveChatMobileActiveTabId("/chat")).toBe("home");
    expect(resolveChatMobileActiveTabId("/chat/rooms/abc")).toBeNull();
    expect(resolveChatMobileActiveTabId("/chat/chats")).toBe("chats");
  });

  it("marks Chats active only on /chat/chats", () => {
    expect(resolveChatMobileActiveTabId("/chat/chats")).toBe("chats");
    expect(resolveChatMobileActiveTabId("/chat/chats/extra")).toBeNull();
  });

  it("returns null when no link tab matches", () => {
    expect(resolveChatMobileActiveTabId("/tasks")).toBeNull();
    expect(resolveChatMobileActiveTabId("/history")).toBeNull();
  });
});

describe("ChatMobileBottomNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = "/chat";
    mockIsApple = false;
    mockHistorySearch = {
      openHistorySearch: openHistorySearchMock,
      searchShortcutLabel: "Ctrl+K",
    };
  });

  it("renders Home, Chats, and Search — not History", () => {
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "home" })).toHaveAttribute(
      "href",
      "/chat",
    );
    expect(screen.getByRole("link", { name: "chats" })).toHaveAttribute(
      "href",
      "/chat/chats",
    );
    expect(screen.getByRole("button", { name: "search" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "history" })).toBeNull();
  });

  it("calls openHistorySearch when Search is clicked", () => {
    render(<ChatMobileBottomNav />);

    fireEvent.click(screen.getByRole("button", { name: "search" }));

    expect(openHistorySearchMock).toHaveBeenCalledTimes(1);
  });

  it("disables Search when HistorySearch provider is absent", () => {
    mockHistorySearch = null;
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("button", { name: "search" })).toBeDisabled();
  });

  it("sets aria-current on the Home link for exact /chat", () => {
    mockPathname = "/chat";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "chats" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("sets aria-current on the Chats link for /chat/chats", () => {
    mockPathname = "/chat/chats";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "chats" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "home" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("uses a docked full-width bar when not on Apple", () => {
    render(<ChatMobileBottomNav />);

    const nav = screen.getByRole("navigation", { name: "ariaLabel" });
    expect(nav.className).toContain("inset-x-0");
    expect(nav.className).toContain("border-t");
    expect(nav.className).not.toContain("rounded-full");
  });

  it("uses a floating capsule bar on Apple platforms", () => {
    mockIsApple = true;
    render(<ChatMobileBottomNav />);

    const nav = screen.getByRole("navigation", { name: "ariaLabel" });
    expect(nav.className).toContain("rounded-full");
    expect(nav.className).toContain("inset-x-4");
    expect(nav.className).toContain("backdrop-blur-2xl");
    expect(nav.className).not.toContain("border-t");

    expect(screen.getByRole("link", { name: "home" }).className).toContain(
      "rounded-full",
    );
    expect(screen.getByRole("link", { name: "home" }).className).toContain(
      "bg-foreground/10",
    );
  });
});
