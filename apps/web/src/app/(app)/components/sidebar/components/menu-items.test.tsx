vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null, isPending: false }),
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openHistorySearchMock = vi.fn();
const setOpenMobileMock = vi.fn();
const openNewTaskWizardMock = vi.fn();
const { pathnameRef, searchRef } = vi.hoisted(() => ({
  pathnameRef: { current: "/" },
  searchRef: { current: "" },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
  useSearchParams: () => new URLSearchParams(searchRef.current),
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
import { OrganizationSeatContext } from "@/contexts/organization-seat-context";
import { TestQueryProvider } from "@/test/query-provider";

let sidebarIsMobile = true;

function renderMenu(
  hasAssignedSeat = true,
  isMobile = true,
  socialMenuEnabled = false,
) {
  sidebarIsMobile = isMobile;
  return render(
    <TestQueryProvider>
      <OrganizationSeatContext value={hasAssignedSeat}>
        <MenuItems socialMenuEnabled={socialMenuEnabled} />
      </OrganizationSeatContext>
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

  it("no longer lists Credit History in the sidebar", () => {
    renderMenu();

    expect(screen.queryByRole("link", { name: /history/i })).toBeNull();
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
    expect(screen.queryByRole("link", { name: /projects/i })).toBeNull();
  });

  it("does not show Calendar in the sidebar", () => {
    renderMenu();

    expect(screen.queryByRole("link", { name: /calendar/i })).toBeNull();
  });

  it("shows Schedules to everyone", () => {
    renderMenu();

    expect(screen.getByRole("link", { name: /schedules/i })).toHaveAttribute(
      "href",
      "/schedules",
    );
  });

  it("hides Files from the main menu on mobile", () => {
    renderMenu(true, true);

    expect(screen.queryByRole("link", { name: /drive/i })).toBeNull();
  });

  it("shows Files after Schedules and the studio on desktop", () => {
    const { container } = renderMenu(true, false);
    const menuLabels = Array.from(container.querySelectorAll("button, a")).map(
      (element) => element.textContent ?? "",
    );

    const primaryOrder = [
      "search",
      "exploreAgents",
      "taskManager",
      "schedules",
      "contentStudio",
      "drive",
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

  it("orders primary destinations Search, Agents, Tasks, Schedules, Studio", () => {
    const { container } = renderMenu(true);
    const menuLabels = Array.from(container.querySelectorAll("button, a")).map(
      (element) => element.textContent ?? "",
    );

    const primaryOrder = [
      "search",
      "exploreAgents",
      "taskManager",
      "schedules",
      "contentStudio",
    ];
    const positions = primaryOrder.map((label) =>
      menuLabels.findIndex((text) => text.includes(label)),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  /**
   * Social was a tab inside one project. It is a destination now, and it is
   * still beta-gated, so the row exists exactly where the surface does —
   * including in the Instant Nav shell, which renders `MenuItems` with no
   * props at all and must therefore leave the row out rather than guess it.
   */
  it("leaves Social out until the frame resolves the beta", () => {
    renderMenu();

    expect(screen.queryByRole("link", { name: /social/i })).toBeNull();
  });

  it("shows Social inside the beta, scoped like the rows above it", () => {
    pathnameRef.current = "/studio";
    searchRef.current = "projectId=project-1";
    renderMenu(true, true, true);
    pathnameRef.current = "/";
    searchRef.current = "";

    // `hrefFor` carries the reader's project across, the way Tasks and the
    // studio do, so switching project does not drop them back to no scope.
    expect(screen.getByRole("link", { name: /social/i })).toHaveAttribute(
      "href",
      "/social?projectId=project-1",
    );
  });

  it("puts Social after the studio and before Files", () => {
    const { container } = renderMenu(true, false, true);
    const menuLabels = Array.from(container.querySelectorAll("button, a")).map(
      (element) => element.textContent ?? "",
    );

    const order = ["contentStudio", "social", "drive"];
    const positions = order.map((label) =>
      menuLabels.findIndex((text) => text.includes(label)),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("keeps the separator under New Task on the collapsed rail", () => {
    const { container } = render(
      <TestQueryProvider>
        <MenuItems />
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
        <MenuItems />
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

  it("keeps the New Task pill's inset and padding across the collapse", () => {
    renderMenu(true, false);
    const pill = document.querySelector("[data-sidebar-new-task]");
    // The rail square's own 4px inset and padding, at every width, so the
    // collapse narrows the pill without sliding its edge.
    expect(pill?.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["ml-1", "pl-1", "w-[calc(100%-0.5rem)]"]),
    );
    // And the name clips instead of re-ellipsizing on every frame.
    expect(
      pill
        ?.querySelector('[data-slot="sidebar-row-slot"]')
        ?.nextElementSibling?.className.split(/\s+/),
    ).toContain("text-clip!");
  });

  it("gives every menu item its label as a hover hint for the collapsed rail", () => {
    renderMenu(true, false);

    expect(
      screen.getAllByTestId("menu-tooltip").map((hint) => hint.textContent),
    ).toEqual([
      "newTask",
      "searchCtrl+K",
      "exploreAgents",
      "taskManager",
      "schedules",
      "contentStudio",
      "drive",
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
    pathnameRef.current = "/tasks/task-1";
    renderMenu();
    expect(markedHrefs()).toEqual(["/tasks"]);
  });

  // The actions (new task, search) are not destinations, so nothing is open.
  it("marks nothing on a route no nav item owns", () => {
    pathnameRef.current = "/";
    renderMenu();
    expect(screen.queryByTestId("rail-selection-bar")).toBeNull();
  });
});

describe("MenuItems project scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    newTaskWizardValue = { openNewTaskWizard: openNewTaskWizardMock };
    pathnameRef.current = "/tasks";
    searchRef.current = "";
  });

  it("omits the old Projects navigation row", () => {
    renderMenu(true, false);

    expect(screen.queryByRole("link", { name: "projects" })).toBeNull();
  });

  it("keeps plain destination links in the workspace view", () => {
    renderMenu(true, false);

    for (const [name, href] of [
      ["taskManager", "/tasks"],
      ["schedules", "/schedules"],
      ["contentStudio", "/studio"],
      ["drive", "/drive"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
  });

  it("carries the selected project to scoped destinations", () => {
    searchRef.current = "projectId=p-1";
    renderMenu(true, false);

    for (const [name, href] of [
      ["taskManager", "/tasks?projectId=p-1"],
      ["schedules", "/schedules?projectId=p-1"],
      ["contentStudio", "/studio?projectId=p-1"],
      ["drive", "/drive?view=tasks&projectId=p-1"],
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    expect(screen.getByRole("link", { name: "exploreAgents" })).toHaveAttribute(
      "href",
      "/agents",
    );
  });

  it("passes the current project when opening New Task", () => {
    searchRef.current = "projectId=p-1";
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: /newTask/i }));

    expect(openNewTaskWizardMock).toHaveBeenCalledWith({ projectId: "p-1" });
  });

  it("keeps the current project in the New Task fallback link", () => {
    searchRef.current = "projectId=p-1";
    newTaskWizardValue = null;
    renderMenu();

    expect(screen.getByRole("link", { name: /newTask/i })).toHaveAttribute(
      "href",
      "/tasks?projectId=p-1&create=true",
    );
  });

  it("keeps the project when navigating from its overview", () => {
    pathnameRef.current = "/projects/p-1";
    renderMenu(true, false);

    expect(screen.getByRole("link", { name: "taskManager" })).toHaveAttribute(
      "href",
      "/tasks?projectId=p-1",
    );
    expect(screen.queryByTestId("rail-selection-bar")).toBeNull();
  });
});
