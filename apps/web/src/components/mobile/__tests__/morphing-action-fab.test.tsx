import { render, screen } from "@testing-library/react";
import { Hash } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

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

import { MorphingActionFab } from "../morphing-action-fab";

describe("MorphingActionFab", () => {
  it("single-action mode is a Link without menu", () => {
    const { container } = render(
      <MorphingActionFab href="/chat?dm=new" label="Start a chat" />,
    );
    const link = screen.getByRole("link", { name: "Start a chat" });
    expect(link).toHaveAttribute("href", "/chat?dm=new");
    expect(container.querySelector("[data-mobile-create-fab-menu]")).toBeNull();
  });

  it("menu mode renders dial when actions provided", () => {
    render(
      <MorphingActionFab
        label="Create"
        closeLabel="Close"
        actions={[
          {
            id: "channel",
            href: "/chat?create=channel",
            label: "Create channel",
            icon: Hash,
          },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  });
});
