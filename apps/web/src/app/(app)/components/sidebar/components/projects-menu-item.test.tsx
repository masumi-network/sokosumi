import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SidebarMenu,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  pathname: "/projects/project-1/tasks",
  organizationId: "org-1" as string | null,
  userId: "user-1",
  pending: false,
  refetching: false,
  mobile: false,
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mocks.mobile }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: mocks.userId },
      session: { activeOrganizationId: mocks.organizationId },
    },
    isPending: mocks.pending,
    isRefetching: mocks.refetching,
  }),
}));
vi.mock("@/app/projects/actions", () => ({ loadMoreProjects: mocks.load }));
vi.mock("next/link", () => ({
  default: ({
    prefetch: _prefetch,
    ...props
  }: ComponentProps<"a"> & { prefetch?: boolean }) => <a {...props} />,
}));

import { recentProjectsStorageKey } from "@/hooks/use-recent-projects";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { ProjectsMenuItem } from "./projects-menu-item";

const VISITS_KEY = recentProjectsStorageKey({
  userId: "user-1",
  organizationId: "org-1",
});

function MobileState() {
  const { openMobile, setOpenMobile } = useSidebar();
  return (
    <button type="button" onClick={() => setOpenMobile(true)}>
      {openMobile ? "mobile-open" : "mobile-closed"}
    </button>
  );
}

function setup(open = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Tree() {
    return (
      <QueryClientProvider client={client}>
        <SidebarProvider open={open}>
          <MobileState />
          <SidebarMenu>
            <ProjectsMenuItem />
          </SidebarMenu>
        </SidebarProvider>
      </QueryClientProvider>
    );
  }
  return { ...render(<Tree />), refresh: () => <Tree /> };
}

/** Hrefs of the flyout's project rows, in render order. */
function projectHrefs(): string[] {
  return screen
    .getAllByRole("link")
    .map((el) => el.getAttribute("href") ?? "")
    .filter((href) => href.startsWith("/projects/"));
}

/**
 * Focus, not hover: Radix opens the card on either, and the keyboard path has
 * no delay to wait out. Reaching the rows by tabbing to the row is also the
 * behaviour worth holding, since the pointer path cannot be the only one.
 */
function openFlyout() {
  fireEvent.focus(screen.getByRole("link", { name: "projects" }));
}

/** Placeholder rows standing in for the names that have not arrived. */
function skeletonRowCount(): number {
  return document.querySelectorAll('li[aria-hidden="true"]').length;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  mocks.organizationId = "org-1";
  mocks.userId = "user-1";
  mocks.pending = false;
  mocks.refetching = false;
  mocks.mobile = false;
  mocks.pathname = "/projects/project-1/tasks";
  mocks.load.mockResolvedValue({
    projects: [{ id: "project-1", name: "Launch plan" }],
    nextCursor: null,
  });
});

describe("Projects sidebar", () => {
  it("keeps the label in the accessibility tree when the rail collapses", () => {
    setup();
    const slot = screen
      .getByRole("link", { name: "projects" })
      .querySelector('[data-slot="sidebar-row-slot"]');
    const label = slot?.nextElementSibling;
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

  it("writes nothing to browser storage of its own", async () => {
    setup();
    openFlyout();
    await screen.findByRole("link", { name: "Launch plan" });
    // No disclosure choice to persist, and the rows are never cached here.
    expect(localStorage.length).toBe(0);
  });

  it("loads the rows before the pointer arrives", async () => {
    setup();
    expect(screen.getByRole("link", { name: "projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
    // The fetch is already in flight while the panel is still shut.
    expect(mocks.load).toHaveBeenCalledWith({
      cursor: null,
      expectedScope: { userId: "user-1", organizationId: "org-1" },
    });
    expect(
      screen.queryByRole("link", { name: "Launch plan" }),
    ).not.toBeInTheDocument();
    openFlyout();
    expect(
      await screen.findByRole("link", { name: "Launch plan" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "projects" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("opens without a loading state and does not refetch when the reader comes back", async () => {
    setup();
    openFlyout();
    await screen.findByRole("link", { name: "Launch plan" });
    fireEvent.blur(screen.getByRole("link", { name: "projects" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "Launch plan" }),
      ).not.toBeInTheDocument(),
    );
    openFlyout();
    // The rows are already there, so the panel never stands on a skeleton and
    // the page is not asked for again.
    expect(
      await screen.findByRole("link", { name: "Launch plan" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it("offers no flyout for a workspace without projects", async () => {
    mocks.load.mockResolvedValue({ projects: [], nextCursor: null });
    setup();
    // The row keeps its link and drops the affordance that promises a panel.
    const row = screen.getByRole("link", { name: "projects" });
    await waitFor(() =>
      expect(
        row.querySelector(".lucide-chevron-right"),
      ).not.toBeInTheDocument(),
    );
    openFlyout();
    expect(projectHrefs()).toEqual([]);
  });

  it("never promises a panel it will have to retract", async () => {
    mocks.load.mockResolvedValue({ projects: [], nextCursor: null });
    setup();
    const row = screen.getByRole("link", { name: "projects" });
    // Not on the first paint, while the page is still in flight…
    expect(row.querySelector(".lucide-chevron-right")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    // …and not once an empty workspace comes back, so the row never changes
    // shape under the reader.
    expect(row.querySelector(".lucide-chevron-right")).not.toBeInTheDocument();
  });

  it("stands the rows in with a skeleton while they load", async () => {
    mocks.load.mockImplementation(() => new Promise(() => {}));
    setup();
    openFlyout();
    await screen.findByRole("status");
    // The panel floats, so the count is a constant rather than an estimate.
    expect(skeletonRowCount()).toBe(5);
  });

  it("shows failure and retries", async () => {
    mocks.load
      .mockRejectedValueOnce(new Error("Forbidden"))
      .mockResolvedValueOnce({
        projects: [{ id: "project-1", name: "Launch plan" }],
        nextCursor: null,
      });
    setup();
    openFlyout();
    const retry = await screen.findByRole("button", { name: "retryProjects" });
    expect(screen.getByRole("status")).toHaveTextContent("projectsError");
    fireEvent.click(retry);
    expect(
      await screen.findByRole("link", { name: "Launch plan" }),
    ).toBeInTheDocument();
  });

  it("drops old workspace rows and ignores an old in-flight response", async () => {
    let finish: (page: {
      projects: { id: string; name: string }[];
      nextCursor: null;
    }) => void = () => {};
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = setup();
    openFlyout();
    mocks.load.mockResolvedValueOnce({
      projects: [{ id: "personal", name: "Personal project" }],
      nextCursor: null,
    });
    mocks.organizationId = null;
    view.rerender(view.refresh());
    openFlyout();
    await act(async () =>
      finish({
        projects: [{ id: "private", name: "Old org secret" }],
        nextCursor: null,
      }),
    );
    expect(screen.queryByText("Old org secret")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "Personal project" }),
    ).toBeInTheDocument();
    expect(mocks.load).toHaveBeenLastCalledWith({
      cursor: null,
      expectedScope: { userId: "user-1", organizationId: null },
    });
    mocks.refetching = true;
    view.rerender(view.refresh());
    expect(screen.queryByText("Personal project")).not.toBeInTheDocument();
  });

  it("caps the flyout at whole rows instead of scrolling inside itself", async () => {
    const name = "A long project name ".repeat(20).trim();
    mocks.load.mockResolvedValue({
      projects: Array.from({ length: 12 }, (_, i) => ({
        id: String(i),
        name: i === 0 ? name : `Project ${i}`,
      })),
      nextCursor: "page-2",
    });
    setup();
    openFlyout();
    const first = await screen.findByTitle(name);
    expect(first).toHaveAttribute("href", "/projects/0");
    expect(projectHrefs()).toEqual([
      "/projects/0",
      "/projects/1",
      "/projects/2",
      "/projects/3",
      "/projects/4",
    ]);
    // One page is enough for five rows, and the list never nests a scroller.
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(first.closest("ul")?.className ?? "").not.toMatch(
      /overflow-y-auto|max-h-/,
    );
  });

  it("does not rank another user's visits in the same workspace", async () => {
    localStorage.setItem(
      recentProjectsStorageKey({
        userId: "user-2",
        organizationId: "org-1",
      }),
      JSON.stringify(["7", "9"]),
    );
    mocks.load.mockResolvedValue({
      projects: Array.from({ length: 12 }, (_, i) => ({
        id: String(i),
        name: `Project ${i}`,
      })),
      nextCursor: null,
    });
    setup();
    openFlyout();
    await screen.findByRole("link", { name: "Project 0" });
    expect(projectHrefs()).toEqual([
      "/projects/0",
      "/projects/1",
      "/projects/2",
      "/projects/3",
      "/projects/4",
    ]);
  });

  it("does not rank the same user's visits from another workspace", async () => {
    localStorage.setItem(
      recentProjectsStorageKey({
        userId: "user-1",
        organizationId: "org-2",
      }),
      JSON.stringify(["7", "9"]),
    );
    mocks.load.mockResolvedValue({
      projects: Array.from({ length: 12 }, (_, i) => ({
        id: String(i),
        name: `Project ${i}`,
      })),
      nextCursor: null,
    });
    setup();
    openFlyout();
    await screen.findByRole("link", { name: "Project 0" });
    expect(projectHrefs()).toEqual([
      "/projects/0",
      "/projects/1",
      "/projects/2",
      "/projects/3",
      "/projects/4",
    ]);
  });

  it("ranks the reader's last visits ahead of Core's activity order", async () => {
    localStorage.setItem(VISITS_KEY, JSON.stringify(["7", "9"]));
    mocks.load.mockResolvedValue({
      projects: Array.from({ length: 12 }, (_, i) => ({
        id: String(i),
        name: `Project ${i}`,
      })),
      nextCursor: null,
    });
    setup();
    openFlyout();
    await screen.findByRole("link", { name: "Project 7" });
    expect(projectHrefs()).toEqual([
      "/projects/7",
      "/projects/9",
      "/projects/0",
      "/projects/1",
      "/projects/2",
    ]);
  });

  it("ignores a visit log entry the workspace no longer carries", async () => {
    localStorage.setItem(
      VISITS_KEY,
      JSON.stringify(["from-another-workspace", "project-1"]),
    );
    setup();
    openFlyout();
    await screen.findByRole("link", { name: "Launch plan" });
    expect(projectHrefs()).toEqual(["/projects/project-1"]);
  });

  it("offers a way to the full list from inside the panel", async () => {
    setup();
    openFlyout();
    await screen.findByRole("link", { name: "Launch plan" });
    const all = screen.getByRole("link", { name: "allProjects" });
    expect(all).toHaveAttribute("href", "/projects");
    // No avatar: a placeholder square read as a project with a broken logo.
    expect(all.querySelector('[data-slot="avatar"]')).not.toBeInTheDocument();
    // Still reachable when the rows themselves could not be had.
    expect(projectHrefs()).toEqual(["/projects/project-1"]);
  });

  it("renders the established avatar fallback without changing the accessible link name", async () => {
    setup();
    openFlyout();
    const link = await screen.findByRole("link", { name: "Launch plan" });
    expect(link.querySelector('[data-slot="avatar"]')).toBeInTheDocument();
    expect(link.querySelector(".lucide-check")).not.toBeInTheDocument();
    expect(link).toHaveAttribute("data-active", "true");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(
      link.querySelector('[data-slot="avatar-fallback"]'),
    ).toHaveTextContent("L");
  });

  it("reaches the rows from the collapsed rail, where they used to be unreachable", async () => {
    setup(false);
    expect(screen.getByRole("link", { name: "projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    // A 56px rail has nowhere to put rows, but the panel floats clear of it.
    openFlyout();
    await screen.findByRole("link", { name: "Launch plan" });
    expect(projectHrefs()).toEqual(["/projects/project-1"]);
  });

  it("dismisses the mobile sheet on navigation", async () => {
    mocks.mobile = true;
    setup(false);
    fireEvent.click(screen.getByRole("button", { name: "mobile-closed" }));
    openFlyout();
    expect(
      screen.getByRole("button", { name: "mobile-open" }),
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("link", { name: "Launch plan" }));
    expect(
      screen.getByRole("button", { name: "mobile-closed" }),
    ).toBeInTheDocument();
  });
});

it.each([en, de, es])(
  "ships flyout and status strings in the sidebar message namespace",
  (messages) => {
    const labels = messages.App.Sidebar.Content.MenuItems;
    for (const key of [
      "projects",
      "allProjects",
      "projectsLoading",
      "projectsError",
      "retryProjects",
    ] as const) {
      expect(labels[key]).toEqual(expect.any(String));
      expect(labels[key].length).toBeGreaterThan(0);
    }
  },
);
