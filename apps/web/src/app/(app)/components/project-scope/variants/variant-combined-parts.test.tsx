import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  replace: vi.fn(),
  switchWorkspace: vi.fn(),
  isSwitching: { current: false },
  pathname: { current: "/tasks" },
  search: { current: "" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  usePathname: () => mocks.pathname.current,
  useSearchParams: () => new URLSearchParams(mocks.search.current),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1", name: "Ada", email: "ada@example.com" },
      session: { activeOrganizationId: "org-1" },
    },
    isPending: false,
    error: null,
  }),
}));
vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({
    isPending: mocks.isSwitching.current,
    handleSelectWorkspace: mocks.switchWorkspace,
  }),
}));
vi.mock("./variant-combined-actions", () => ({
  loadCombinedWorkspaces: mocks.load,
}));
vi.mock("@/app/projects/actions", () => ({
  loadMoreProjects: vi.fn(),
  loadPinnedProjects: vi.fn(),
}));
vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: () => null,
}));
vi.mock("@/app/components/header/header-workspace-avatar", () => ({
  default: () => <span aria-hidden />,
}));
vi.mock("@/app/projects/components/project-avatar", () => ({
  ProjectAvatar: () => <span aria-hidden data-testid="project-avatar" />,
}));

import {
  type CombinedWorkspaces,
  SwitchingPane,
  useCombinedScope,
  useCombinedWorkspaces,
  WorkspaceList,
  WorkspaceMark,
} from "./variant-combined-parts";

function member(id: string, name: string) {
  return { organization: { id, name } };
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

async function renderLoaded() {
  const hook = renderHook(() => useCombinedWorkspaces(), {
    wrapper: wrapper(),
  });
  await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  return hook;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isSwitching.current = false;
  mocks.pathname.current = "/tasks";
  mocks.search.current = "";
  mocks.switchWorkspace.mockResolvedValue(undefined);
  mocks.load.mockResolvedValue({
    members: [member("org-1", "Acme"), member("org-2", "Globex")],
    hasPersonalWorkspace: false,
  });
});

describe("useCombinedWorkspaces", () => {
  it("lists the personal workspace only when the user has one", async () => {
    const without = await renderLoaded();
    expect(without.result.current.rows.map((row) => row.id)).toEqual([
      "org-1",
      "org-2",
    ]);

    mocks.load.mockResolvedValue({
      members: [member("org-1", "Acme")],
      hasPersonalWorkspace: true,
    });
    const withPersonal = await renderLoaded();
    expect(withPersonal.result.current.rows).toEqual([
      { id: null, name: "Ada", organization: null },
      {
        id: "org-1",
        name: "Acme",
        organization: { id: "org-1", name: "Acme" },
      },
    ]);
  });

  it("does not switch to the workspace that is already active", async () => {
    const { result } = await renderLoaded();

    await act(() => result.current.select("org-1"));

    expect(mocks.switchWorkspace).not.toHaveBeenCalled();
  });

  it("does not start a second switch while one runs", async () => {
    mocks.isSwitching.current = true;
    const { result } = await renderLoaded();

    await act(() => result.current.select("org-2"));

    expect(mocks.switchWorkspace).not.toHaveBeenCalled();
  });

  it("swallows a failed switch and keeps the project scope", async () => {
    mocks.search.current = "projectId=project-1";
    mocks.switchWorkspace.mockRejectedValue(new Error("switch failed"));
    const { result } = await renderLoaded();

    await expect(
      act(() => result.current.select("org-2")),
    ).resolves.toBeUndefined();

    expect(mocks.switchWorkspace).toHaveBeenCalledWith("org-2");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("drops the project scope after a switch", async () => {
    mocks.search.current = "projectId=project-1";
    const { result } = await renderLoaded();

    await act(() => result.current.select("org-2"));

    expect(mocks.switchWorkspace).toHaveBeenCalledWith("org-2");
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/tasks");
  });

  it("keeps a navigation the user made during the switch", async () => {
    mocks.search.current = "projectId=project-1";
    let finish = () => {};
    mocks.switchWorkspace.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = await renderLoaded();

    let selecting = Promise.resolve();
    act(() => {
      selecting = result.current.select("org-2");
    });
    // A sidebar link, followed while the switch runs.
    window.history.pushState(null, "", "/agents");
    finish();
    await act(() => selecting);

    expect(mocks.switchWorkspace).toHaveBeenCalledWith("org-2");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("stays on the page after a switch with no project in scope", async () => {
    const { result } = await renderLoaded();

    await act(() => result.current.select("org-2"));

    expect(mocks.switchWorkspace).toHaveBeenCalledWith("org-2");
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

describe("WorkspaceList", () => {
  it("says the workspaces failed, outside the list, with a retry", async () => {
    const refetch = vi.fn();
    const workspaces: CombinedWorkspaces = {
      sessionUser: null,
      rows: [],
      activeId: null,
      active: null,
      isPending: false,
      isError: true,
      refetch,
      isSwitching: false,
      select: vi.fn(),
    };
    render(<WorkspaceList workspaces={workspaces} />);

    expect(screen.getByRole("status")).toHaveTextContent("workspacesError");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe("useCombinedScope mark", () => {
  function Mark() {
    return <>{useCombinedScope().mark}</>;
  }

  function renderMark() {
    const Wrapper = wrapper();
    return render(
      <Wrapper>
        <Mark />
      </Wrapper>,
    );
  }

  function skeleton(container: HTMLElement) {
    return container.querySelector('[data-slot="skeleton"]');
  }

  function projectIcon(container: HTMLElement) {
    return container.querySelector(".lucide-folder-kanban");
  }

  beforeEach(() => {
    mocks.search.current = "projectId=project-1";
  });

  it("pulses while the scoped project loads", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const { container } = renderMark();

    expect(skeleton(container)).toBeInTheDocument();
    expect(projectIcon(container)).not.toBeInTheDocument();
  });

  it("shows the project once it loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          project: { id: "project-1", name: "Apollo", logo: null },
        }),
      ),
    );
    renderMark();

    expect(await screen.findByTestId("project-avatar")).toBeInTheDocument();
  });

  it("stops pulsing when the read fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "down" }, { status: 502 })),
    );
    const { container } = renderMark();

    await waitFor(() => expect(projectIcon(container)).toBeInTheDocument());
    expect(skeleton(container)).not.toBeInTheDocument();
  });

  it("stops pulsing when Core does not know the project", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ project: null })),
    );
    const { container } = renderMark();

    await waitFor(() => expect(projectIcon(container)).toBeInTheDocument());
    expect(skeleton(container)).not.toBeInTheDocument();
  });
});

describe("WorkspaceMark", () => {
  const settled: CombinedWorkspaces = {
    sessionUser: null,
    rows: [],
    activeId: null,
    active: null,
    isPending: false,
    isError: true,
    refetch: vi.fn(),
    isSwitching: false,
    select: vi.fn(),
  };

  it("pulses only while the workspaces load", () => {
    const { container, rerender } = render(
      <WorkspaceMark
        workspaces={{ ...settled, isPending: true, isError: false }}
        workspace={null}
      />,
    );
    expect(
      container.querySelector('[data-slot="skeleton"]'),
    ).toBeInTheDocument();

    rerender(<WorkspaceMark workspaces={settled} workspace={null} />);
    expect(
      container.querySelector('[data-slot="skeleton"]'),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(".lucide-building-2, .lucide-building2"),
    ).toBeInTheDocument();
  });
});

describe("SwitchingPane", () => {
  it("shuts and marks busy only while a switch runs", () => {
    const { rerender } = render(
      <SwitchingPane isSwitching>
        <button type="button">old project</button>
      </SwitchingPane>,
    );
    const pane = screen.getByTestId("project-scope-combined-project-pane");
    expect(pane).toHaveAttribute("inert");
    expect(pane).toHaveAttribute("aria-busy", "true");

    rerender(
      <SwitchingPane isSwitching={false}>
        <button type="button">old project</button>
      </SwitchingPane>,
    );
    expect(pane).not.toHaveAttribute("inert");
    expect(pane).not.toHaveAttribute("aria-busy");
  });
});
