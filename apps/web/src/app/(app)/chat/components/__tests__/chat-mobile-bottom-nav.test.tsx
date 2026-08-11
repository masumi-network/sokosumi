import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat/chats";
let mockSearchParams = new URLSearchParams();
let mockIsApple = false;
let mockShowUnreadDot = false;

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

vi.mock("../use-chat-tab-unread-presence", () => ({
  useChatTabUnreadPresence: () => ({ showUnreadDot: mockShowUnreadDot }),
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
  it("marks each tab active only on its exact list-root pathname", () => {
    expect(resolveChatMobileActiveTabId("/tasks")).toBe("tasks");
    expect(resolveChatMobileActiveTabId("/agents")).toBe("agents");
    expect(resolveChatMobileActiveTabId("/chat/chats")).toBe("chats");
    expect(resolveChatMobileActiveTabId("/projects")).toBe("projects");
    expect(resolveChatMobileActiveTabId("/history")).toBe("search");
  });

  it("returns null on bare /chat, drafts, rooms, and nested routes", () => {
    expect(resolveChatMobileActiveTabId("/chat")).toBeNull();
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
      resolveChatMobileActiveTabId("/chat", new URLSearchParams("dm=new")),
    ).toBeNull();
    expect(resolveChatMobileActiveTabId("/chat/rooms/abc")).toBeNull();
    expect(resolveChatMobileActiveTabId("/chat/chats/extra")).toBeNull();
    expect(resolveChatMobileActiveTabId("/tasks/t1")).toBeNull();
    expect(resolveChatMobileActiveTabId("/agents/a1")).toBeNull();
    expect(resolveChatMobileActiveTabId("/projects/p1")).toBeNull();
    expect(resolveChatMobileActiveTabId("/account")).toBeNull();
  });
});

describe("ChatMobileBottomNav", () => {
  beforeEach(() => {
    mockPathname = "/chat/chats";
    mockSearchParams = new URLSearchParams();
    mockIsApple = false;
    mockShowUnreadDot = false;
  });

  it("renders Tasks, Agents, Chats, Projects, Search in order with Spec hrefs", () => {
    render(<ChatMobileBottomNav />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/tasks",
      "/agents",
      "/chat/chats",
      "/projects",
      "/history",
    ]);
    expect(screen.getByRole("link", { name: "tasks" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "agents" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "chats" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "projects" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "search" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "home" })).toBeNull();
  });

  it("sets aria-current on the Chats link for /chat/chats", () => {
    mockPathname = "/chat/chats";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "chats" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "tasks" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "search" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("sets aria-current on Tasks for /tasks", () => {
    mockPathname = "/tasks";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "tasks" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "chats" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("sets aria-current on Agents for /agents", () => {
    mockPathname = "/agents";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "agents" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("sets aria-current on Projects for /projects", () => {
    mockPathname = "/projects";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "projects" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("sets aria-current on the Search link for /history", () => {
    mockPathname = "/history";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "search" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "chats" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("does not set aria-current on any tab for bare /chat", () => {
    mockPathname = "/chat";
    render(<ChatMobileBottomNav />);

    for (const name of ["tasks", "agents", "chats", "projects", "search"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
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

    expect(screen.getByRole("link", { name: "chats" }).className).toContain(
      "rounded-full",
    );
    expect(screen.getByRole("link", { name: "chats" }).className).toContain(
      "bg-foreground/10",
    );
  });

  it("exposes a route-agnostic nav aria-label (used on hub list routes)", () => {
    mockPathname = "/tasks";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("navigation", { name: "ariaLabel" })).toBeTruthy();
  });

  it("shows an unread presence dot on the Chats tab when attention exists", () => {
    mockShowUnreadDot = true;
    render(<ChatMobileBottomNav />);

    expect(screen.getByLabelText("chatsUnread")).toBeTruthy();
    expect(screen.getByLabelText("chatsUnread").className).toContain(
      "bg-primary",
    );
    expect(screen.getByLabelText("chatsUnread").className).toContain(
      "size-1.5",
    );
    expect(screen.getByRole("link", { name: /chats/i })).toBeTruthy();
  });

  it("hides the unread presence dot when no attention remains", () => {
    mockShowUnreadDot = false;
    render(<ChatMobileBottomNav />);

    expect(screen.queryByLabelText("chatsUnread")).toBeNull();
  });
});
