vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null, isPending: false }),
}));

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  useSidebar: () => ({ isMobile: sidebarIsMobile }),
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
  newsletterEnabled = false,
) {
  sidebarIsMobile = isMobile;
  return render(
    <TestQueryProvider>
      <OrganizationSeatContext value={hasAssignedSeat}>
        <MenuItems
          socialBetaEnabled={socialBetaEnabled}
          newsletterEnabled={newsletterEnabled}
        />
      </OrganizationSeatContext>
    </TestQueryProvider>,
  );
}

describe("MenuItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidebarIsMobile = true;
  });

  it("no longer lists Credit History in the sidebar", () => {
    renderMenu();

    expect(screen.queryByRole("link", { name: /history/i })).toBeNull();
  });

  // New task is the sidebar header's action (`SidebarNewTaskButton`).
  it("has no New task row, and no separator under one", () => {
    const { container } = renderMenu();

    expect(screen.queryByRole("link", { name: /newTask/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /newTask/i })).toBeNull();
    expect(container.querySelector('li[aria-hidden="true"]')).toBeNull();
  });

  it("leaves Search to the app header", () => {
    renderMenu();

    expect(screen.queryByRole("button", { name: /search/i })).toBeNull();
  });

  it("keeps product destinations when the member has no assigned seat", () => {
    renderMenu(false);

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

  it("names the Social destination Social posts", () => {
    renderMenu();

    expect(screen.getByRole("link", { name: "social" })).toHaveAttribute(
      "href",
      "/social",
    );
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
});

/** The destinations a nav heading folds, in order, by its `aria-controls`. */
function destinationsUnder(heading: string) {
  const button = screen.getByRole("button", { name: heading });
  const group = document.getElementById(
    button.getAttribute("aria-controls") ?? "",
  );
  if (!group) return [];
  return within(group)
    .getAllByRole("link")
    .map((link) => link.textContent);
}

describe("MenuItems groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameRef.current = "/";
    searchRef.current = "";
  });

  it("files each destination under its Work, Records or Marketing heading", () => {
    renderMenu(true, false, true);

    expect(destinationsUnder("groups.work")).toEqual([
      "home",
      "exploreAgents",
      "taskManager",
      "schedules",
    ]);
    expect(destinationsUnder("groups.records")).toEqual(["contacts", "drive"]);
    expect(destinationsUnder("groups.marketing")).toEqual([
      "contentStudio",
      "social",
      "ads",
    ]);
  });

  it("puts the headings in the order Work, Records, Marketing", () => {
    renderMenu(true, false);

    const headings = screen
      .getAllByRole("button", { name: /^groups\./ })
      .map((button) => button.textContent);
    expect(headings).toEqual([
      "groups.work",
      "groups.records",
      "groups.marketing",
    ]);
  });

  it("folds a group from its heading and opens it again", () => {
    renderMenu(true, false);
    const heading = screen.getByRole("button", { name: "groups.marketing" });
    expect(heading).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(heading);

    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "contentStudio" })).toBeNull();
    expect(screen.queryByRole("link", { name: "social" })).toBeNull();
    // Only its own rows go.
    expect(screen.getByRole("link", { name: "contacts" })).toBeInTheDocument();

    fireEvent.click(heading);

    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("link", { name: "contentStudio" }),
    ).toBeInTheDocument();
  });

  // The wordmark's link to `/` became this row when the Workspace switcher
  // took the sidebar header.
  it("leads Work with Home, a plain link to the home page", () => {
    searchRef.current = "projectId=p-1";
    renderMenu(true, false);

    expect(destinationsUnder("groups.work")[0]).toBe("home");
    expect(screen.getByRole("link", { name: "home" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  // The phone keeps Home on the Sokosumi icon in its top bar.
  it("groups the phone sheet the same way, without Home", () => {
    renderMenu(true, true);

    expect(destinationsUnder("groups.work")).toEqual([
      "exploreAgents",
      "taskManager",
      "schedules",
    ]);
    // Files stays on the You page there.
    expect(destinationsUnder("groups.records")).toEqual(["contacts"]);
    expect(destinationsUnder("groups.marketing")).toEqual([
      "contentStudio",
      "social",
    ]);
  });
});

describe("MenuItems newsletter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameRef.current = "/";
    searchRef.current = "";
  });

  it("leaves Newsletter out of the Instant Nav shell by default", () => {
    render(
      <TestQueryProvider>
        <MenuItems />
      </TestQueryProvider>,
    );

    expect(screen.queryByRole("link", { name: "newsletter" })).toBeNull();
  });

  it("shows Newsletter when enabled independently of the Ads beta", () => {
    renderMenu(true, false, false, true);

    expect(screen.getByRole("link", { name: "newsletter" })).toHaveAttribute(
      "href",
      "/newsletter",
    );
    expect(screen.queryByRole("link", { name: "ads" })).toBeNull();
  });

  it("carries the selected project to Newsletter", () => {
    pathnameRef.current = "/studio";
    searchRef.current = "projectId=project-1";
    renderMenu(true, true, false, true);

    expect(screen.getByRole("link", { name: "newsletter" })).toHaveAttribute(
      "href",
      "/newsletter?projectId=project-1",
    );
  });

  it("files Newsletter under Marketing, after Social and Ads", () => {
    renderMenu(true, false, true, true);

    expect(destinationsUnder("groups.marketing")).toEqual([
      "contentStudio",
      "social",
      "ads",
      "newsletter",
    ]);
  });

  it.each([
    "/newsletter",
    "/projects/project-1/newsletter",
    "/projects/project-1/newsletter/issues/issue-1",
    "/projects/project-1/newsletter/subscribers",
  ])("marks Newsletter current on %s", (pathname) => {
    pathnameRef.current = pathname;
    renderMenu(true, false, false, true);

    expect(screen.getByRole("link", { name: "newsletter" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not mark Newsletter current on another project section", () => {
    pathnameRef.current = "/projects/project-1/newsletter-settings";
    renderMenu(true, false, false, true);

    expect(
      screen.getByRole("link", { name: "newsletter" }),
    ).not.toHaveAttribute("aria-current");
  });
});

describe("MenuItems current destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidebarIsMobile = false;
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

  it("marks Home on the home page, and only there", () => {
    pathnameRef.current = "/";
    renderMenu(true, false);
    expect(markedHrefs()).toEqual(["/"]);
  });

  // A route no destination owns has nothing open.
  it("marks nothing on a route no nav item owns", () => {
    pathnameRef.current = "/account";
    renderMenu(true, false);
    expect(markedHrefs()).toEqual([]);
  });
});

describe("MenuItems project scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
