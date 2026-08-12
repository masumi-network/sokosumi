import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat/chats";
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
      ...props
    }: {
      children?: React.ReactNode;
      className?: string;
      [key: string]: unknown;
    }) => (
      <div className={className} {...props}>
        {children}
      </div>
    ),
    button: ({
      children,
      className,
      onClick,
      ...props
    }: {
      children?: React.ReactNode;
      className?: string;
      onClick?: () => void;
      [key: string]: unknown;
    }) => (
      <button type="button" className={className} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    span: ({
      children,
      className,
      ...props
    }: {
      children?: React.ReactNode;
      className?: string;
      [key: string]: unknown;
    }) => (
      <span className={className} {...props}>
        {children}
      </span>
    ),
    ul: ({
      children,
      className,
      ...props
    }: {
      children?: React.ReactNode;
      className?: string;
      [key: string]: unknown;
    }) => (
      <ul className={className} {...props}>
        {children}
      </ul>
    ),
    li: ({
      children,
      className,
      ...props
    }: {
      children?: React.ReactNode;
      className?: string;
      [key: string]: unknown;
    }) => (
      <li className={className} {...props}>
        {children}
      </li>
    ),
  },
  useReducedMotion: () => true,
}));

import { ChatOnboardingFab } from "../chat-onboarding-fab";

describe("ChatOnboardingFab", () => {
  beforeEach(() => {
    mockPathname = "/chat/chats";
    mockSearchParams = new URLSearchParams();
    mockIsApple = false;
  });

  it("is a single-action link to onboarding host", () => {
    const { container } = render(<ChatOnboardingFab />);
    const link = screen.getByRole("link", { name: "openFab" });
    expect(link).toHaveAttribute("href", "/chat?welcome=1");
    expect(container.querySelector("[data-mobile-create-fab-menu]")).toBeNull();
    expect(screen.queryByRole("button", { name: "openMenu" })).toBeNull();
  });

  it("hides on bare /chat home surface", () => {
    mockPathname = "/chat";
    render(<ChatOnboardingFab />);
    expect(screen.queryByRole("link", { name: "openFab" })).toBeNull();
  });

  it("hides on welcome compose and draft query surfaces", () => {
    mockPathname = "/chat";
    mockSearchParams = new URLSearchParams("welcome=1");
    const { unmount } = render(<ChatOnboardingFab />);
    expect(screen.queryByRole("link", { name: "openFab" })).toBeNull();
    unmount();

    mockSearchParams = new URLSearchParams("create=channel");
    render(<ChatOnboardingFab />);
    expect(screen.queryByRole("link", { name: "openFab" })).toBeNull();
  });

  it("is marked md:hidden", () => {
    const { container } = render(<ChatOnboardingFab />);
    expect(
      container.querySelector("[data-mobile-create-fab]")?.className,
    ).toContain("md:hidden");
  });
});
