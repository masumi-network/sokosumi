import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openHistorySearchMock = vi.fn();
const setOpenMobileMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

let historySearchValue: {
  openHistorySearch: typeof openHistorySearchMock;
  searchShortcutLabel: string;
} | null = {
  openHistorySearch: openHistorySearchMock,
  searchShortcutLabel: "Ctrl+K",
};

vi.mock("@/app/components/history-search-dialog-provider", () => ({
  useOptionalHistorySearch: () => historySearchValue,
}));

vi.mock("@/lib/actions/hermes", () => ({
  getHermesUnreadCountAction: vi.fn().mockResolvedValue({ ok: true, data: 0 }),
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
  useSidebar: () => ({
    isMobile: true,
    setOpenMobile: setOpenMobileMock,
  }),
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

describe("MenuItems search action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historySearchValue = {
      openHistorySearch: openHistorySearchMock,
      searchShortcutLabel: "Ctrl+K",
    };
  });

  it("opens history search and closes the mobile sidebar when search is clicked", () => {
    render(<MenuItems />);

    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    expect(openHistorySearchMock).toHaveBeenCalledTimes(1);
    expect(setOpenMobileMock).toHaveBeenCalledWith(false);
  });

  it("still closes the mobile sidebar when history search is unavailable", () => {
    historySearchValue = null;
    render(<MenuItems />);

    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    expect(openHistorySearchMock).not.toHaveBeenCalled();
    expect(setOpenMobileMock).toHaveBeenCalledWith(false);
  });

  it("shows History by default", () => {
    render(<MenuItems />);

    expect(screen.getByRole("link", { name: /history/i })).toHaveAttribute(
      "href",
      "/history",
    );
  });

  it("hides History when hideHistory is set", () => {
    render(<MenuItems hideHistory />);

    expect(screen.queryByRole("link", { name: /history/i })).toBeNull();
  });

  it("shows New Task by default", () => {
    render(<MenuItems />);

    expect(screen.getByRole("link", { name: /newTask/i })).toHaveAttribute(
      "href",
      "/tasks?create=true",
    );
  });

  it("hides New Task when hideNewTask is set", () => {
    render(<MenuItems hideNewTask />);

    expect(screen.queryByRole("link", { name: /newTask/i })).toBeNull();
  });

  it("shows Search by default", () => {
    render(<MenuItems />);

    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  it("hides Search when hideSearch is set", () => {
    render(<MenuItems hideSearch />);

    expect(screen.queryByRole("button", { name: /search/i })).toBeNull();
  });
});
