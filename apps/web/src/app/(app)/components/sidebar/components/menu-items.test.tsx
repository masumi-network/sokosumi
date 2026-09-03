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
    isMobile: sidebarIsMobile,
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
import { OrganizationSeatProvider } from "@/contexts/organization-seat-context";

let sidebarIsMobile = true;

function renderMenu(
  hasAssignedSeat = true,
  calendarMenuEnabled = false,
  isMobile = true,
) {
  sidebarIsMobile = isMobile;
  return render(
    <OrganizationSeatProvider hasAssignedSeat={hasAssignedSeat}>
      <MenuItems calendarMenuEnabled={calendarMenuEnabled} />
    </OrganizationSeatProvider>,
  );
}

describe("MenuItems search action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidebarIsMobile = true;
    historySearchValue = {
      openHistorySearch: openHistorySearchMock,
      searchShortcutLabel: "Ctrl+K",
    };
  });

  it("opens history search and closes the mobile sidebar when search is clicked", () => {
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    expect(openHistorySearchMock).toHaveBeenCalledTimes(1);
    expect(setOpenMobileMock).toHaveBeenCalledWith(false);
  });

  it("still closes the mobile sidebar when history search is unavailable", () => {
    historySearchValue = null;
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    expect(openHistorySearchMock).not.toHaveBeenCalled();
    expect(setOpenMobileMock).toHaveBeenCalledWith(false);
  });

  it("shows History by default", () => {
    renderMenu();

    expect(screen.getByRole("link", { name: /history/i })).toHaveAttribute(
      "href",
      "/history",
    );
  });

  it("shows New Task by default", () => {
    renderMenu();

    expect(screen.getByRole("link", { name: /newTask/i })).toHaveAttribute(
      "href",
      "/tasks?create=true",
    );
  });

  it("shows Search by default", () => {
    renderMenu();

    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });

  it("keeps product destinations when the member has no assigned seat", () => {
    renderMenu(false);

    expect(screen.getByRole("link", { name: /newTask/i })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /taskManager/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /projects/i })).toBeInTheDocument();
  });

  it("shows Calendar only to NMKR users", () => {
    const { rerender } = renderMenu();

    expect(screen.queryByRole("link", { name: /calendar/i })).toBeNull();

    sidebarIsMobile = true;
    rerender(
      <OrganizationSeatProvider hasAssignedSeat>
        <MenuItems calendarMenuEnabled />
      </OrganizationSeatProvider>,
    );

    expect(screen.getByRole("link", { name: /calendar/i })).toHaveAttribute(
      "href",
      "/calendar",
    );
  });

  it("hides Files from the main menu on mobile", () => {
    renderMenu(true, true, true);

    expect(screen.queryByRole("link", { name: /drive/i })).toBeNull();
  });

  it("shows Files after Schedules on desktop", () => {
    const { container } = renderMenu(true, true, false);
    const menuLabels = Array.from(container.querySelectorAll("button, a")).map(
      (element) => element.textContent ?? "",
    );

    const primaryOrder = [
      "search",
      "exploreAgents",
      "projects",
      "taskManager",
      "calendar",
      "drive",
      "history",
    ];
    const positions = primaryOrder.map((label) =>
      menuLabels.findIndex((text) => text.includes(label)),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(screen.getByRole("link", { name: /drive/i })).toHaveAttribute(
      "href",
      "/drive",
    );
  });

  it("orders primary destinations Search, Agents, Projects, Tasks, Schedules, History", () => {
    const { container } = renderMenu(true, true);
    const menuLabels = Array.from(container.querySelectorAll("button, a")).map(
      (element) => element.textContent ?? "",
    );

    const primaryOrder = [
      "search",
      "exploreAgents",
      "projects",
      "taskManager",
      "calendar",
      "history",
    ];
    const positions = primaryOrder.map((label) =>
      menuLabels.findIndex((text) => text.includes(label)),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
