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

function expand() {
  fireEvent.click(screen.getByRole("button", { name: "expandProjects" }));
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
    const view = setup();
    const tree = view.refresh();
    view.unmount();
    localStorage.setItem("sokosumi.sidebar.projects-expanded", "true");
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    expect(container.querySelector("button[aria-expanded]")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    const onRecoverableError = vi.fn();
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError });
    });
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
    expand();
    await screen.findByRole("link", { name: "Launch plan" });
    expect(localStorage.getItem("sokosumi.sidebar.projects-expanded")).toBe(
      "true",
    );
    expect(localStorage.length).toBe(1);
    first.unmount();
    const second = setup();
    await screen.findByRole("link", { name: "Launch plan" });
    fireEvent.click(screen.getByRole("button", { name: "collapseProjects" }));
    expect(localStorage.getItem("sokosumi.sidebar.projects-expanded")).toBe(
      "false",
    );
    second.unmount();
    mocks.load.mockClear();
    setup();
    expect(
      screen.getByRole("button", { name: "expandProjects" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("keeps disclosure usable when browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Blocked");
    });
    setup();
    expand();
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

  it("keeps overview navigation and loads only after disclosure, with current-project semantics", async () => {
    setup();
    expect(screen.getByRole("link", { name: "projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(
      screen
        .getByRole("link", { name: "projects" })
        .querySelector('[data-slot="sidebar-row-slot"]'),
    ).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "expandProjects" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      document.getElementById(trigger.getAttribute("aria-controls") ?? ""),
    ).toHaveAttribute("hidden");
    expand();
    expect(
      await screen.findByRole("link", { name: "Launch plan" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "projects" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(mocks.load).toHaveBeenCalledWith({
      cursor: null,
      expectedScope: { userId: "user-1", organizationId: "org-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "collapseProjects" }));
    expect(
      screen.queryByRole("link", { name: "Launch plan" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "expandProjects" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("shows loading, failure, retry and empty states", async () => {
    mocks.load
      .mockRejectedValueOnce(new Error("Forbidden"))
      .mockResolvedValueOnce({ projects: [], nextCursor: null });
    setup();
    expand();
    expect(screen.getByRole("status")).toHaveTextContent("projectsLoading");
    expect(
      await screen.findByRole("button", { name: "retryProjects" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("projectsError");
    fireEvent.click(screen.getByRole("button", { name: "retryProjects" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("projectsEmpty"),
    );
    expect(
      screen.queryByRole("link", { name: "viewAllProjects" }),
    ).not.toBeInTheDocument();
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
    expand();
    mocks.load.mockResolvedValueOnce({
      projects: [{ id: "personal", name: "Personal project" }],
      nextCursor: null,
    });
    mocks.organizationId = null;
    view.rerender(view.refresh());
    expect(
      screen.getByRole("button", { name: "collapseProjects" }),
    ).toHaveAttribute("aria-expanded", "true");
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

  it("loads every page on scroll or keyboard focus, preserving API order and long names", async () => {
    const name = "A long project name ".repeat(20).trim();
    mocks.load
      .mockResolvedValueOnce({
        projects: Array.from({ length: 20 }, (_, i) => ({
          id: String(i),
          name: i === 0 ? name : `Project ${i}`,
        })),
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        projects: [{ id: "20", name: "Page two" }],
        nextCursor: "page-3",
      })
      .mockResolvedValueOnce({
        projects: [{ id: "21", name: "Last project" }],
        nextCursor: null,
      });
    setup();
    expand();
    const link = await screen.findByTitle(name);
    expect(link).toHaveAttribute("href", "/projects/0");
    expect(screen.getAllByRole("link")).toHaveLength(21);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    fireEvent.scroll(link.closest("ul")!);
    const second = await screen.findByRole("link", { name: "Page two" });
    fireEvent.focus(second);
    await screen.findByRole("link", { name: "Last project" });
    expect(
      screen
        .getAllByRole("link")
        .slice(-2)
        .map((el) => el.textContent),
    ).toEqual(["PPage two", "LLast project"]);
    expect(mocks.load.mock.calls.map(([args]) => args.cursor)).toEqual([
      null,
      "page-2",
      "page-3",
    ]);
    expect(screen.queryByText("viewAllProjects")).not.toBeInTheDocument();
  });

  it("hides stale pages after a page failure and retries the failed cursor", async () => {
    mocks.load
      .mockResolvedValueOnce({
        projects: [{ id: "1", name: "First" }],
        nextCursor: "next",
      })
      .mockRejectedValueOnce(new Error("Forbidden"))
      .mockResolvedValueOnce({
        projects: [{ id: "2", name: "Second" }],
        nextCursor: null,
      });
    setup();
    expand();
    fireEvent.focus(await screen.findByRole("link", { name: "First" }));
    const retry = await screen.findByRole("button", { name: "retryProjects" });
    expect(
      screen.queryByRole("link", { name: "First" }),
    ).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(
      await screen.findByRole("link", { name: "Second" }),
    ).toBeInTheDocument();
    expect(mocks.load.mock.calls.map(([args]) => args.cursor)).toEqual([
      null,
      "next",
      "next",
    ]);
  });

  it("ignores a late next page when switching workspaces", async () => {
    let finish: (value: {
      projects: { id: string; name: string }[];
      nextCursor: null;
    }) => void = () => {};
    mocks.load
      .mockResolvedValueOnce({
        projects: [{ id: "old", name: "Old workspace" }],
        nextCursor: "next",
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const view = setup();
    expand();
    fireEvent.focus(await screen.findByRole("link", { name: "Old workspace" }));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    mocks.load.mockResolvedValueOnce({
      projects: [{ id: "new", name: "New workspace" }],
      nextCursor: null,
    });
    mocks.organizationId = null;
    view.rerender(view.refresh());
    await act(async () =>
      finish({
        projects: [{ id: "secret", name: "Late private project" }],
        nextCursor: null,
      }),
    );
    expect(screen.queryByText("Old workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Late private project")).not.toBeInTheDocument();

    expect(
      await screen.findByRole("link", { name: "New workspace" }),
    ).toBeInTheDocument();
  });

  it("renders the established avatar fallback without changing the accessible link name", async () => {
    setup();
    expand();
    const link = await screen.findByRole("link", { name: "Launch plan" });
    expect(link.querySelector('[data-slot="avatar"]')).toBeInTheDocument();
    expect(link.querySelector(".lucide-check")).not.toBeInTheDocument();
    expect(link).toHaveAttribute("data-active", "true");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(
      link.querySelector('[data-slot="avatar-fallback"]'),
    ).toHaveTextContent("L");
  });

  it("keeps the collapsed rail as an overview link without fetching", () => {
    setup(false);
    expect(screen.getByRole("link", { name: "projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(
      screen.queryByRole("button", { name: "expandProjects" }),
    ).not.toBeInTheDocument();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("allows disclosure on mobile even when desktop is collapsed, then dismisses on navigation", async () => {
    mocks.mobile = true;
    setup(false);
    fireEvent.click(screen.getByRole("button", { name: "mobile-closed" }));
    expand();
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
      "projectsEmpty",
      "retryProjects",
    ] as const) {
      expect(labels[key]).toEqual(expect.any(String));
      expect(labels[key].length).toBeGreaterThan(0);
    }
  },
);
