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
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  ProjectAvatar: () => <span aria-hidden />,
}));

import {
  type CombinedWorkspaces,
  useCombinedWorkspaces,
  WorkspaceList,
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
