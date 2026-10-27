vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null, isPending: false }),
}));

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    asChild: _asChild,
    isActive: _isActive,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    asChild?: boolean;
    isActive?: boolean;
  }) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  // Props ride through, so the separator item keeps its own `<li>` markup.
  SidebarMenuItem: ({ children, ...props }: { children: React.ReactNode }) => (
    <li {...props}>{children}</li>
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

import MenuItems from "@/app/components/sidebar/components/menu-items";
import { OrganizationSeatContext } from "@/contexts/organization-seat-context";
import { TestQueryProvider } from "@/test/query-provider";

let sidebarIsMobile = true;

function renderMenu(
  hasAssignedSeat = true,
  isMobile = true,
  socialBetaEnabled = false,
) {
  sidebarIsMobile = isMobile;
  return render(
    <TestQueryProvider>
      <OrganizationSeatContext value={hasAssignedSeat}>
        <MenuItems socialBetaEnabled={socialBetaEnabled} />
      </OrganizationSeatContext>
    </TestQueryProvider>,
  );
}

describe("MenuItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidebarIsMobile = true;
    newTaskWizardValue = { openNewTaskWizard: openNewTaskWizardMock };
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

  it("leaves Search to the app header", () => {
    renderMenu();

    expect(screen.queryByRole("button", { name: /search/i })).toBeNull();
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
      "exploreAgents",
      "taskManager",
      "schedules",
      "contacts",
      "contentStudio",
      "social",
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

  it("orders primary destinations Agents, Tasks, Schedules, Studio", () => {
    const { container } = renderMenu(true);
    const menuLabels = Array.from(container.querySelectorAll("button, a")).map(
      (element) => element.textContent ?? "",
    );

    const primaryOrder = [
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

  it("shows Social before the Ads beta is resolved", () => {
    renderMenu();
    expect(screen.getByRole("link", { name: /social/i })).toBeInTheDocument();
  });

  it("shows public Social scoped like the rows above it", () => {
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

  /** The retained beta flag gates Ads only. */
  it("leaves Ads out until the frame resolves the beta", () => {
    renderMenu();

    expect(screen.queryByRole("link", { name: /ads/i })).toBeNull();
  });

  it("shows Ads inside the beta, scoped to the reader's project", () => {
    pathnameRef.current = "/studio";
    searchRef.current = "projectId=project-1";
    renderMenu(true, true, true);
    pathnameRef.current = "/";
    searchRef.current = "";

    expect(screen.getByRole("link", { name: /ads/i })).toHaveAttribute(
      "href",
      "/ads?projectId=project-1",
    );
  });

  it("puts Ads after Social and before Files", () => {
    const { container } = renderMenu(true, false, true);
    const menuLabels = Array.from(container.querySelectorAll("button, a")).map(
      (element) => element.textContent ?? "",
    );

    const order = ["social", "ads", "drive"];
    const positions = order.map((label) =>
      menuLabels.findIndex((text) => text.includes(label)),
    );

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("sets New Task apart from the destinations with a separator", () => {
    const { container } = render(
      <TestQueryProvider>
        <MenuItems />
      </TestQueryProvider>,
    );
    const separator = container.querySelector('li[aria-hidden="true"]');

    expect(separator).not.toBeNull();
    expect(separator?.firstElementChild?.className.split(/\s+/)).toContain(
      "bg-sidebar-border",
    );
  });

  it("puts each destination's icon in the shared row slot", () => {
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
    expect(slot?.nextElementSibling).toHaveTextContent("exploreAgents");
  });

  it("keeps the New Task pill's + on the rows' leading axis", () => {
    renderMenu(true, false);
    const pill = document.querySelector("[data-sidebar-new-task]");
    // A 4px inset plus 4px padding is the 8px every other row's `px-2` gives.
    expect(pill?.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["ml-1", "pl-1", "w-[calc(100%-0.5rem)]"]),
    );
  });
});

describe("MenuItems current destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidebarIsMobile = false;
    newTaskWizardValue = { openNewTaskWizard: openNewTaskWizardMock };
    pathnameRef.current = "/";
  });

  // A count alone would pass with the mark on the wrong row, which is the one
  // way this can fail without looking broken.
  function markedHrefs() {
    return [...document.querySelectorAll('a[aria-current="page"]')].map(
      (link) => link.getAttribute("href"),
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
    expect(markedHrefs()).toEqual([]);
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
      ["contacts", "/contacts"],
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
      // Contacts belong to the workspace, not a project.
      ["contacts", "/contacts"],
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
    expect(document.querySelector('a[aria-current="page"]')).toBeNull();
  });
});
