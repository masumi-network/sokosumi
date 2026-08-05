import { fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  motion: {
    div: ({
      children,
      className,
    }: {
      children?: React.ReactNode;
      className?: string;
    }) => <div className={className}>{children}</div>,
    button: ({
      children,
      className,
      onClick,
      ...props
    }: {
      children?: React.ReactNode;
      className?: string;
      onClick?: () => void;
    }) => (
      <button type="button" className={className} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    span: ({
      children,
      className,
    }: {
      children?: React.ReactNode;
      className?: string;
    }) => <span className={className}>{children}</span>,
  },
  useReducedMotion: () => true,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}));

import { ChatMobileCreateFab } from "../chat-mobile-create-fab";

describe("ChatMobileCreateFab", () => {
  beforeEach(() => {
    mockPathname = "/chat";
    mockSearchParams = new URLSearchParams();
    mockIsApple = false;
  });

  it("shows on home and opens home actions", () => {
    render(<ChatMobileCreateFab />);

    fireEvent.click(screen.getByRole("button", { name: "openMenu" }));

    expect(
      screen.getByRole("link", { name: /newChat\.title/i }),
    ).toHaveAttribute("href", "/chat?welcome=1");
    expect(
      screen.getByRole("link", { name: /newTask\.title/i }),
    ).toHaveAttribute("href", "/tasks?create=true");
    expect(
      screen.getByRole("link", { name: /createChannel\.title/i }),
    ).toHaveAttribute("href", "/chat?create=channel");
    expect(screen.getByRole("link", { name: /newDm\.title/i })).toHaveAttribute(
      "href",
      "/chat?dm=new",
    );
  });

  it("shows chats actions without new chat or new task", () => {
    mockPathname = "/chat/chats";
    render(<ChatMobileCreateFab />);

    fireEvent.click(screen.getByRole("button", { name: "openMenu" }));

    expect(screen.queryByRole("link", { name: /newChat\.title/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /newTask\.title/i })).toBeNull();
    expect(
      screen.getByRole("link", { name: /createChannel\.title/i }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /newDm\.title/i })).toBeTruthy();
  });

  it("hides on welcome compose and draft query surfaces", () => {
    mockSearchParams = new URLSearchParams("welcome=1");
    const { unmount } = render(<ChatMobileCreateFab />);
    expect(screen.queryByRole("button", { name: "openMenu" })).toBeNull();
    unmount();

    mockSearchParams = new URLSearchParams("create=channel");
    render(<ChatMobileCreateFab />);
    expect(screen.queryByRole("button", { name: "openMenu" })).toBeNull();
  });

  it("hides on rooms and non-hub routes", () => {
    mockPathname = "/chat/rooms/r1";
    const { unmount } = render(<ChatMobileCreateFab />);
    expect(screen.queryByRole("button", { name: "openMenu" })).toBeNull();
    unmount();

    mockPathname = "/tasks";
    render(<ChatMobileCreateFab />);
    expect(screen.queryByRole("button", { name: "openMenu" })).toBeNull();
  });

  it("is marked md:hidden", () => {
    const { container } = render(<ChatMobileCreateFab />);
    expect(
      container.querySelector("[data-mobile-create-fab]")?.className,
    ).toContain("md:hidden");
  });
});
