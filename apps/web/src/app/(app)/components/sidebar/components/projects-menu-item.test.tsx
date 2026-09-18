import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
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

import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { ProjectsMenuItem } from "./projects-menu-item";

const EXPANDED_KEY = "sokosumi.sidebar.projects-expanded";
const VISITS_KEY = "sokosumi.sidebar.recent-projects.v1";

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

/** Hrefs of the disclosure's project rows, in render order. */
function projectHrefs(): string[] {
  return screen
    .getAllByRole("link")
    .map((el) => el.getAttribute("href") ?? "")
    .filter((href) => href.startsWith("/projects/"));
}

/** The control only exists once there is something behind it, so wait for it. */
async function expand() {
  fireEvent.click(
    await screen.findByRole("button", { name: "expandProjects" }),
  );
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
  it("hydrates the server default before restoring a saved expanded choice", async () => {
    // Its own client, and rows that never arrive, so the server string and the
    // first client render agree on having nothing yet.
    mocks.load.mockImplementation(() => new Promise(() => {}));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (
      <QueryClientProvider client={client}>
        <SidebarProvider open>
          <SidebarMenu>
            <ProjectsMenuItem />
          </SidebarMenu>
        </SidebarProvider>
      </QueryClientProvider>
    );
    localStorage.setItem(EXPANDED_KEY, "true");
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    // Nothing is loaded on the server, so the row is a plain link: no control
    // to disclose, and no rows to give away.
    expect(container.querySelector("button[aria-expanded]")).toBeNull();
    expect(container.querySelectorAll('a[href^="/projects/"]')).toHaveLength(0);
    const onRecoverableError = vi.fn();
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError });
    });
    // The saved choice comes back after hydration, standing on the skeleton
    // until the rows land.
    await waitFor(() =>
      expect(container.querySelector("button[aria-expanded]")).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );
    expect(onRecoverableError).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    container.remove();
  });

  it("restores both disclosure choices after remount without persisting project data", async () => {
    const first = setup();
    await expand();
    await screen.findByRole("link", { name: "Launch plan" });
    expect(localStorage.getItem(EXPANDED_KEY)).toBe("true");
    // Only the reader's disclosure choice is written here; the rows are not.
    expect(localStorage.length).toBe(1);
    first.unmount();
    const second = setup();
    await screen.findByRole("link", { name: "Launch plan" });
    fireEvent.click(screen.getByRole("button", { name: "collapseProjects" }));
    expect(localStorage.getItem(EXPANDED_KEY)).toBe("false");
    second.unmount();
    setup();
    expect(
      await screen.findByRole("button", { name: "expandProjects" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps disclosure usable when browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    setup();
    await expand();
    await screen.findByRole("link", { name: "Launch plan" });
    fireEvent.click(screen.getByRole("button", { name: "collapseProjects" }));
    expect(
      screen.queryByRole("link", { name: "Launch plan" }),
    ).not.toBeInTheDocument();
  });

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

  it("loads the rows before the reader opens the disclosure", async () => {
    setup();
    expect(screen.getByRole("link", { name: "projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
    // The fetch is already in flight while the disclosure is still shut.
    expect(mocks.load).toHaveBeenCalledWith({
      cursor: null,
      expectedScope: { userId: "user-1", organizationId: "org-1" },
    });
    expect(
      screen.queryByRole("link", { name: "Launch plan" }),
    ).not.toBeInTheDocument();
    await expand();
    expect(
      await screen.findByRole("link", { name: "Launch plan" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "projects" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("opens without a loading state and does not refetch when the reader comes back", async () => {
    setup();
    await expand();
    await screen.findByRole("link", { name: "Launch plan" });
    fireEvent.click(screen.getByRole("button", { name: "collapseProjects" }));
    fireEvent.click(screen.getByRole("button", { name: "expandProjects" }));
    // Same frame: the rows are already there, with no loading status between.
    expect(
      screen.getByRole("link", { name: "Launch plan" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });

  it("offers no disclosure for a workspace without projects", async () => {
    mocks.load.mockResolvedValue({ projects: [], nextCursor: null });
    setup();
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "expandProjects" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "projects" })).toBeInTheDocument();
  });

  it("stands the rows in with a skeleton for a reader who left it open", async () => {
    localStorage.setItem(EXPANDED_KEY, "true");
    mocks.load.mockImplementation(() => new Promise(() => {}));
    setup();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "projectsLoading",
    );
    expect(projectHrefs()).toEqual([]);
    // Still closable while it waits, so the skeleton is never trapped open.
    expect(
      screen.getByRole("button", { name: "collapseProjects" }),
    ).toBeInTheDocument();
  });

  it("shows failure and retries", async () => {
    localStorage.setItem(EXPANDED_KEY, "true");
    mocks.load
      .mockRejectedValueOnce(new Error("Forbidden"))
      .mockResolvedValueOnce({
        projects: [{ id: "project-1", name: "Launch plan" }],
        nextCursor: null,
      });
    setup();
    const retry = await screen.findByRole("button", { name: "retryProjects" });
    expect(screen.getByRole("status")).toHaveTextContent("projectsError");
    fireEvent.click(retry);
    expect(
      await screen.findByRole("link", { name: "Launch plan" }),
    ).toBeInTheDocument();
  });

  it("animates the disclosure open and closed", async () => {
    setup();
    await expand();
    await screen.findByRole("link", { name: "Launch plan" });
    const content = document.querySelector('[data-slot="collapsible-content"]');
    const classes = content?.className.split(/\s+/) ?? [];
    expect(classes).toContain(
      "motion-safe:data-[state=open]:animate-collapsible-down",
    );
    expect(classes).toContain(
      "motion-safe:data-[state=closed]:animate-collapsible-up",
    );
    expect(classes).toContain("overflow-hidden");
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
    localStorage.setItem(EXPANDED_KEY, "true");
    const view = setup();
    mocks.load.mockResolvedValueOnce({
      projects: [{ id: "personal", name: "Personal project" }],
      nextCursor: null,
    });
    mocks.organizationId = null;
    view.rerender(view.refresh());
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

  it("caps the disclosure at whole rows instead of scrolling inside itself", async () => {
    const name = "A long project name ".repeat(20).trim();
    mocks.load.mockResolvedValue({
      projects: Array.from({ length: 12 }, (_, i) => ({
        id: String(i),
        name: i === 0 ? name : `Project ${i}`,
      })),
      nextCursor: "page-2",
    });
    setup();
    await expand();
    const first = await screen.findByTitle(name);
    expect(first).toHaveAttribute("href", "/projects/0");
    expect(projectHrefs()).toEqual([
      "/projects/0",
      "/projects/1",
      "/projects/2",
      "/projects/3",
      "/projects/4",
    ]);
    // One page is enough for five rows, and the list no longer nests a scroller.
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(first.closest("ul")?.className ?? "").not.toMatch(
      /overflow-y-auto|max-h-/,
    );
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
    await expand();
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
    await expand();
    await screen.findByRole("link", { name: "Launch plan" });
    expect(projectHrefs()).toEqual(["/projects/project-1"]);
  });

  it("renders the established avatar fallback without changing the accessible link name", async () => {
    setup();
    await expand();
    const link = await screen.findByRole("link", { name: "Launch plan" });
    expect(link.querySelector('[data-slot="avatar"]')).toBeInTheDocument();
    expect(link.querySelector(".lucide-check")).not.toBeInTheDocument();
    expect(link).toHaveAttribute("data-active", "true");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(
      link.querySelector('[data-slot="avatar-fallback"]'),
    ).toHaveTextContent("L");
  });

  it("preloads behind the collapsed rail but offers no disclosure there", async () => {
    setup(false);
    expect(screen.getByRole("link", { name: "projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
    // Warm for the moment the reader widens the sidebar…
    await waitFor(() => expect(mocks.load).toHaveBeenCalled());
    // …but a 56px rail has nowhere to put the rows.
    expect(
      screen.queryByRole("button", { name: "expandProjects" }),
    ).not.toBeInTheDocument();
    expect(projectHrefs()).toEqual([]);
  });

  it("allows disclosure on mobile even when desktop is collapsed, then dismisses on navigation", async () => {
    mocks.mobile = true;
    setup(false);
    fireEvent.click(screen.getByRole("button", { name: "mobile-closed" }));
    await expand();
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
  "ships disclosure and status strings in the sidebar message namespace",
  (messages) => {
    const labels = messages.App.Sidebar.Content.MenuItems;
    for (const key of [
      "expandProjects",
      "collapseProjects",
      "projectsLoading",
      "projectsError",
      "retryProjects",
    ] as const) {
      expect(labels[key]).toEqual(expect.any(String));
      expect(labels[key].length).toBeGreaterThan(0);
    }
  },
);
