import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat";
let mockSearchParams = new URLSearchParams();
let mockIsApple = false;

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
  it("marks Home active for /chat and main hub list routes except history", () => {
    expect(resolveChatMobileActiveTabId("/chat")).toBe("home");
    expect(resolveChatMobileActiveTabId("/tasks")).toBe("home");
    expect(resolveChatMobileActiveTabId("/agents")).toBe("home");
    expect(resolveChatMobileActiveTabId("/history")).toBe("search");
    expect(resolveChatMobileActiveTabId("/chat/rooms/abc")).toBeNull();
    expect(resolveChatMobileActiveTabId("/chat/chats")).toBe("chats");
  });

  it("does not mark Home active on draft create/dm/welcome query routes", () => {
    expect(
      resolveChatMobileActiveTabId(
        "/chat",
        new URLSearchParams("create=channel"),
      ),
    ).toBeNull();
    expect(
      resolveChatMobileActiveTabId("/chat", new URLSearchParams("dm=new")),
    ).toBeNull();
    expect(
      resolveChatMobileActiveTabId("/chat", new URLSearchParams("welcome=1")),
    ).toBeNull();
  });

  it("marks Chats active only on /chat/chats", () => {
    expect(resolveChatMobileActiveTabId("/chat/chats")).toBe("chats");
    expect(resolveChatMobileActiveTabId("/chat/chats/extra")).toBeNull();
  });

  it("marks Search active on /history", () => {
    expect(resolveChatMobileActiveTabId("/history")).toBe("search");
  });

  it("returns null when no link tab matches", () => {
    expect(resolveChatMobileActiveTabId("/tasks/t1")).toBeNull();
    expect(resolveChatMobileActiveTabId("/account")).toBeNull();
  });
});

describe("ChatMobileBottomNav", () => {
  beforeEach(() => {
    mockPathname = "/chat";
    mockSearchParams = new URLSearchParams();
    mockIsApple = false;
  });

  it("renders Home, Chats, and Search as links — Search goes to /history", () => {
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "home" })).toHaveAttribute(
      "href",
      "/chat",
    );
    expect(screen.getByRole("link", { name: "chats" })).toHaveAttribute(
      "href",
      "/chat/chats",
    );
    expect(screen.getByRole("link", { name: "search" })).toHaveAttribute(
      "href",
      "/history",
    );
    expect(screen.queryByRole("button", { name: "search" })).toBeNull();
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
    expect(screen.getByRole("link", { name: "search" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("does not set aria-current on Home for draft query routes", () => {
    mockPathname = "/chat";
    mockSearchParams = new URLSearchParams("create=channel");
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "home" })).not.toHaveAttribute(
      "aria-current",
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

  it("sets aria-current on the Search link for /history", () => {
    mockPathname = "/history";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "search" })).toHaveAttribute(
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

  it("exposes a route-agnostic nav aria-label (used on hub list routes)", () => {
    mockPathname = "/tasks";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
  });
});
