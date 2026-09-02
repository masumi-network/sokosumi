import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat";
let mockSearchParams = new URLSearchParams();
let mockIsApple = false;
let mockShowUnreadDot = false;
let mockSessionUser: {
  id: string;
  name: string;
  email: string;
  image: string | null;
} | null = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  image: null,
};

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

vi.mock("./use-chat-tab-unread-presence", () => ({
  useChatTabUnreadPresence: () => ({ showUnreadDot: mockShowUnreadDot }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: mockSessionUser
      ? {
          user: mockSessionUser,
          session: { activeOrganizationId: null },
        }
      : null,
  }),
}));

vi.mock("gravatar-url", () => ({
  default: () => "https://gravatar.example/ada",
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
} from "./chat-mobile-bottom-nav";

describe("resolveChatMobileActiveTabId", () => {
  it("marks each tab active only on its exact list-root pathname", () => {
    expect(resolveChatMobileActiveTabId("/")).toBe("home");
    expect(resolveChatMobileActiveTabId("/tasks")).toBe("tasks");
    expect(resolveChatMobileActiveTabId("/chat")).toBe("chats");
    expect(resolveChatMobileActiveTabId("/projects")).toBe("projects");
    expect(resolveChatMobileActiveTabId("/you")).toBe("you");
    expect(resolveChatMobileActiveTabId("/history")).toBeNull();
  });

  it("returns null on rooms and nested routes", () => {
    expect(
      resolveChatMobileActiveTabId(
        "/chat",
        new URLSearchParams("create=channel"),
      ),
    ).toBe("chats");
    expect(
      resolveChatMobileActiveTabId("/chat", new URLSearchParams("dm=new")),
    ).toBe("chats");
    // Retired param: bare /chat list stays the Chats tab.
    expect(
      resolveChatMobileActiveTabId("/chat", new URLSearchParams("welcome=1")),
    ).toBe("chats");
    expect(resolveChatMobileActiveTabId("/chat/rooms/abc")).toBeNull();
    expect(resolveChatMobileActiveTabId("/tasks/t1")).toBeNull();
    expect(resolveChatMobileActiveTabId("/agents")).toBe("home");
    expect(resolveChatMobileActiveTabId("/agents/a1")).toBeNull();
    expect(resolveChatMobileActiveTabId("/drive")).toBe("home");
    expect(resolveChatMobileActiveTabId("/projects/p1")).toBeNull();
    expect(resolveChatMobileActiveTabId("/account")).toBeNull();
  });
});

describe("ChatMobileBottomNav", () => {
  beforeEach(() => {
    mockPathname = "/chat";
    mockSearchParams = new URLSearchParams();
    mockIsApple = false;
    mockShowUnreadDot = false;
    mockSessionUser = {
      id: "user-1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      image: null,
    };
  });

  it("renders Home, Tasks, Chats, Projects, You in order with Spec hrefs", () => {
    render(<ChatMobileBottomNav />);

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/tasks",
      "/chat",
      "/projects",
      "/you",
    ]);
    expect(screen.getByRole("link", { name: "home" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "tasks" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "chats" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "projects" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "you" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "search" })).toBeNull();
    expect(screen.queryByRole("link", { name: "agents" })).toBeNull();
  });

  it("uses the signed-in user avatar as the You tab affordance", () => {
    render(<ChatMobileBottomNav />);

    expect(screen.getByTestId("mobile-you-tab-avatar")).toBeTruthy();
    expect(screen.queryByTestId("mobile-you-tab-avatar-skeleton")).toBeNull();
  });

  it("shows an avatar skeleton while session user is unavailable", () => {
    mockSessionUser = null;
    render(<ChatMobileBottomNav />);

    expect(screen.getByTestId("mobile-you-tab-avatar-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("mobile-you-tab-avatar")).toBeNull();
  });

  it("sets aria-current on the Chats link for /chat", () => {
    mockPathname = "/chat";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "chats" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "tasks" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "you" })).not.toHaveAttribute(
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

  it("sets aria-current on Home for /", () => {
    mockPathname = "/";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "tasks" })).not.toHaveAttribute(
      "aria-current",
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

  it("sets aria-current on the You link for /you", () => {
    mockPathname = "/you";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "you" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "chats" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("sets aria-current on Home for /agents", () => {
    mockPathname = "/agents";
    render(<ChatMobileBottomNav />);

    expect(screen.getByRole("link", { name: "home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "tasks" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("does not set aria-current on any tab for unmatched paths", () => {
    mockPathname = "/history";
    render(<ChatMobileBottomNav />);

    for (const name of ["home", "tasks", "chats", "projects", "you"]) {
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
