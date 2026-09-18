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
  vi.clearAllMocks();
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
  it("keeps overview navigation and loads only after disclosure, with current-project semantics", async () => {
    setup();
    expect(screen.getByRole("link", { name: "projects" })).toHaveAttribute(
      "href",
      "/projects",
    );
    expect(mocks.load).not.toHaveBeenCalled();
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
      screen.getByRole("link", { name: "viewAllProjects" }),
    ).toHaveAttribute("href", "/projects");
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
    mocks.organizationId = null;
    view.rerender(view.refresh());
    expect(
      screen.getByRole("button", { name: "expandProjects" }),
    ).toHaveAttribute("aria-expanded", "false");
    await act(async () =>
      finish({
        projects: [{ id: "private", name: "Old org secret" }],
        nextCursor: null,
      }),
    );
    expect(screen.queryByText("Old org secret")).not.toBeInTheDocument();
    mocks.load.mockResolvedValueOnce({
      projects: [{ id: "personal", name: "Personal project" }],
      nextCursor: null,
    });
    expand();
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

  it("does not paginate automatically and keeps long project names available", async () => {
    const name = "A long project name ".repeat(20).trim();
    mocks.load.mockResolvedValue({
      projects: Array.from({ length: 20 }, (_, i) => ({
        id: String(i),
        name: i === 0 ? name : `Project ${i}`,
      })),
      nextCursor: "more",
    });
    setup();
    expand();
    const link = await screen.findByTitle(name);
    expect(link).toHaveAttribute("href", "/projects/0");
    expect(screen.getAllByRole("link")).toHaveLength(22);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("link", { name: "viewAllProjects" }),
    ).toBeInTheDocument();
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
      "viewAllProjects",
    ] as const) {
      expect(labels[key]).toEqual(expect.any(String));
      expect(labels[key].length).toBeGreaterThan(0);
    }
  },
);
