import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => false,
}));

vi.mock("@/lib/actions/hermes", () => ({
  getHermesUnreadCountAction: vi.fn().mockResolvedValue({ ok: true, data: 0 }),
}));

vi.mock("@/app/components/history-search-dialog", () => ({
  HistorySearchDialog: ({
    open,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (open ? <div data-testid="history-search-dialog" /> : null),
}));

vi.mock("@/components/ui/sheet", () => ({
  SheetClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <ul>{children}</ul>
  ),
  SidebarMenuButton: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import MenuItems from "@/app/components/sidebar/components/menu-items";

describe("MenuItems search keyboard shortcut", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("does not throw when event.key is undefined", () => {
    render(<MenuItems hermesMenuEnabled={false} />);

    expect(() => {
      fireEvent.keyDown(window, { key: undefined, metaKey: true });
    }).not.toThrow();

    expect(
      screen.queryByTestId("history-search-dialog"),
    ).not.toBeInTheDocument();
  });

  it("opens search dialog on Cmd+K", () => {
    render(<MenuItems hermesMenuEnabled={false} />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(screen.getByTestId("history-search-dialog")).toBeInTheDocument();
  });

  it("opens search dialog on Ctrl+K", () => {
    render(<MenuItems hermesMenuEnabled={false} />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(screen.getByTestId("history-search-dialog")).toBeInTheDocument();
  });

  it("ignores Cmd+K when an input element is the event target", () => {
    render(<MenuItems hermesMenuEnabled={false} />);
    const input = document.createElement("input");
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: "k", metaKey: true });

    expect(
      screen.queryByTestId("history-search-dialog"),
    ).not.toBeInTheDocument();

    document.body.removeChild(input);
  });

  it("ignores non-matching keys", () => {
    render(<MenuItems hermesMenuEnabled={false} />);

    fireEvent.keyDown(window, { key: "j", metaKey: true });

    expect(
      screen.queryByTestId("history-search-dialog"),
    ).not.toBeInTheDocument();
  });
});
