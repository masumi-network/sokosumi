vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null, isPending: false }),
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openHistorySearchMock = vi.fn();
const setOpenMobileMock = vi.fn();
const openNewTaskWizardMock = vi.fn();
const { pathnameRef } = vi.hoisted(() => ({
  pathnameRef: { current: "/" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
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

let newTaskWizardValue: {
  openNewTaskWizard: typeof openNewTaskWizardMock;
} | null = { openNewTaskWizard: openNewTaskWizardMock };

vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => newTaskWizardValue,
}));

vi.mock("@/components/ui/sheet", () => ({
  SheetClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The real module under the overrides, so `SidebarRowSlot` — the shared
// leading slot every row sits its mark in — is the one the app ships.
vi.mock("@/components/ui/sidebar", async () => ({
  ...(await vi.importActual<typeof import("@/components/ui/sidebar")>(
    "@/components/ui/sidebar",
  )),
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
    tooltip,
    asChild: _asChild,
    isActive: _isActive,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    tooltip?: string | { children: React.ReactNode };
    asChild?: boolean;
    isActive?: boolean;
  }) => (
    <>
      <button type="button" onClick={onClick} {...props}>
        {children}
      </button>
      <span data-testid="menu-tooltip">
        {typeof tooltip === "string" ? tooltip : tooltip?.children}
      </span>
    </>
  ),
  // Props ride through: the separator item states on its own `<li>` whether
  // it survives the collapse to the rail.
  SidebarMenuItem: ({ children, ...props }: { children: React.ReactNode }) => (
    <li {...props}>{children}</li>
  ),
  // A marker, not the real bar: how it looks belongs to the primitive that
  // owns it, and `ui/__tests__/sidebar-rail-selection.test.tsx` pins that.
  SidebarRailSelectionBar: () => <span data-testid="rail-selection-bar" />,
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
import { TestQueryProvider } from "@/test/query-provider";

let sidebarIsMobile = true;

function renderMenu(
  hasAssignedSeat = true,
  calendarMenuEnabled = false,
  isMobile = true,
) {
  sidebarIsMobile = isMobile;
  return render(
    <TestQueryProvider>
      <OrganizationSeatProvider hasAssignedSeat={hasAssignedSeat}>
        <MenuItems calendarMenuEnabled={calendarMenuEnabled} />
      </OrganizationSeatProvider>
    </TestQueryProvider>,
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
    newTaskWizardValue = { openNewTaskWizard: openNewTaskWizardMock };
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

  it("opens the New Task wizard in place and closes the mobile sidebar for seated members", () => {
    renderMenu();

    expect(screen.queryByRole("link", { name: /newTask/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /newTask/i }));

    expect(openNewTaskWizardMock).toHaveBeenCalledTimes(1);
    expect(setOpenMobileMock).toHaveBeenCalledWith(false);
  });

  it("links New Task to the Task Manager while the wizard is unavailable", () => {
    newTaskWizardValue = null;
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

    expect(screen.getByRole("link", { name: /newTask/i })).toHaveAttribute(
      "href",
      "/tasks?create=true",
    );
    expect(
      screen.getByRole("link", { name: /taskManager/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /projects/i })).toBeInTheDocument();
  });

  it("shows Calendar only to Calendar beta users", () => {
    const { rerender } = renderMenu();

    expect(screen.queryByRole("link", { name: /calendar/i })).toBeNull();

    sidebarIsMobile = true;
    rerender(
      <TestQueryProvider>
        <OrganizationSeatProvider hasAssignedSeat>
          <MenuItems calendarMenuEnabled />
        </OrganizationSeatProvider>
      </TestQueryProvider>,
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

  it("shows Files after Calendar on desktop", () => {
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

  it("orders primary destinations Search, Agents, Projects, Tasks, Calendar, History", () => {
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

  it("keeps the separator under New Task on the collapsed rail", () => {
    const { container } = render(
      <TestQueryProvider>
        <MenuItems calendarMenuEnabled={false} />
      </TestQueryProvider>,
    );
    const separator = container.querySelector('li[aria-hidden="true"]');

    // The one action set apart from the destinations under it. It used to be
    // expanded-only, which made it 17px the rail did not have, so everything
    // below New Task jumped on a toggle. It is not the hairline between chat
    // sections that the Rail section header entry rules out (CONTEXT.md).
    expect(separator).not.toBeNull();
    expect(separator?.className.split(/\s+/)).not.toContain(
      "group-data-[collapsible=icon]:hidden",
    );
    expect(separator?.firstElementChild?.className.split(/\s+/)).toContain(
      "bg-sidebar-border",
    );
  });

  it("leaves only the icon in the flow on the collapsed rail, so the square centres it", () => {
    render(
      <TestQueryProvider>
        <MenuItems calendarMenuEnabled={false} />
      </TestQueryProvider>,
    );
    const link = screen.getByRole("link", { name: "exploreAgents" });
    // The icon rides the shared 24px slot, so a nav mark sits on the same
    // axis a room's mark does — and the label after it on the same column.
    const slot = link.querySelector('[data-slot="sidebar-row-slot"]');
    expect(slot?.querySelector("svg")).not.toBeNull();
    const label = slot?.nextElementSibling;
    expect(label).not.toBeNull();
    // Shared label class: still in the flow and the accessibility tree.
    // `absolute` painted the name on the mark; `sr-only` clipped it on
    // frame one. max-width eases to 0 instead.
    expect(label?.className.split(/\s+/)).toContain(
      "group-data-[collapsible=icon]:max-w-0",
    );
    expect(label?.className.split(/\s+/)).not.toContain(
      "group-data-[collapsible=icon]:sr-only",
    );
    expect(label?.className.split(/\s+/)).not.toContain(
      "group-data-[collapsible=icon]:hidden",
    );
  });

  it("gives every menu item its label as a hover hint for the collapsed rail", () => {
    renderMenu(true, true, false);

    expect(
      screen.getAllByTestId("menu-tooltip").map((hint) => hint.textContent),
    ).toEqual([
      "newTask",
      "searchCtrl+K",
      "exploreAgents",
      // Projects answers hover with its flyout, so it passes no tooltip that
      // would race the panel to the same spot; the panel's own heading names
      // it there.
      "",
      "taskManager",
      "calendar",
      "drive",
      "history",
    ]);
  });
});

// Collapsed to icons a nav row is a bare glyph and the neutral fill was
// carrying hover and selection alike, so you could not tell the open
// destination from the one under the cursor. Selection moves to the rail's
// right edge, the same mark an open Chat room gets.
describe("MenuItems rail selection bar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidebarIsMobile = false;
    historySearchValue = {
      openHistorySearch: openHistorySearchMock,
      searchShortcutLabel: "Ctrl+K",
    };
    newTaskWizardValue = { openNewTaskWizard: openNewTaskWizardMock };
    pathnameRef.current = "/";
  });

  // A count alone would pass with the mark on the wrong row, which is the one
  // way this can fail without looking broken.
  function markedHrefs() {
    return screen
      .getAllByTestId("rail-selection-bar")
      .map((bar) =>
        bar.closest("li")?.querySelector("a")?.getAttribute("href"),
      );
  }

  it("marks exactly the destination the reader is on", () => {
    pathnameRef.current = "/tasks";
    renderMenu();
    expect(markedHrefs()).toEqual(["/tasks"]);
  });

  it("marks the destination from one of its own pages too", () => {
    pathnameRef.current = "/projects/project-1";
    renderMenu();
    expect(markedHrefs()).toEqual(["/projects"]);
  });

  // The actions (new task, search) are not destinations, so nothing is open.
  it("marks nothing on a route no nav item owns", () => {
    pathnameRef.current = "/";
    renderMenu();
    expect(screen.queryByTestId("rail-selection-bar")).toBeNull();
  });
});
