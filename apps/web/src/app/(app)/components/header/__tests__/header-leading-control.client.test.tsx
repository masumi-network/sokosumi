import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/chat";
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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

vi.mock("@/components/masumi-logos", () => ({
  SokosumiIcon: ({ className }: { className?: string }) => (
    <span data-testid="sokosumi-icon" className={className} />
  ),
}));

import { HeaderLeadingControl } from "../header-leading-control.client";

describe("HeaderLeadingControl", () => {
  beforeEach(() => {
    mockPathname = "/chat";
    mockSearchParams = new URLSearchParams();
  });

  it("shows brand on home", () => {
    render(<HeaderLeadingControl />);
    expect(screen.getByTestId("sokosumi-icon")).toBeTruthy();
  });

  it("shows back to chats on room", () => {
    mockPathname = "/chat/rooms/r1";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToChats" });
    expect(back).toHaveAttribute("href", "/chat/chats");
  });

  it("shows back to chats on draft DM compose", () => {
    mockSearchParams = new URLSearchParams("dm=new");
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToChats" });
    expect(back).toHaveAttribute("href", "/chat/chats");
  });

  it("shows back to home on account (not sidebar trigger)", () => {
    mockPathname = "/account";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToHome" });
    expect(back).toHaveAttribute("href", "/chat");
    expect(
      screen.queryByRole("button", { name: "sidebar-trigger" }),
    ).toBeNull();
  });

  it("shows back to home on billing", () => {
    mockPathname = "/billing";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToHome" });
    expect(back).toHaveAttribute("href", "/chat");
  });

  it("shows back to home on developer", () => {
    mockPathname = "/developer";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToHome" });
    expect(back).toHaveAttribute("href", "/chat");
  });

  it("shows hub back to home on tasks list", () => {
    mockPathname = "/tasks";
    render(<HeaderLeadingControl />);
    const back = screen.getByRole("link", { name: "backToHome" });
    expect(back).toHaveAttribute("href", "/chat");
  });
});
