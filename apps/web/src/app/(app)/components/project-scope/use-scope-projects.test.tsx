import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  loadPinned: vi.fn(),
  loadOne: vi.fn(),
  organizationId: { current: "org-a" },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: mocks.organizationId.current },
    },
    isPending: false,
    error: null,
  }),
}));
vi.mock("@/app/projects/actions", () => ({
  loadMoreProjects: mocks.load,
  loadPinnedProjects: mocks.loadPinned,
}));

import {
  useIsUnknownScopeProject,
  useScopeProjects,
  useSelectedScopeProject,
} from "./use-scope-projects";

function project(id: string, name: string) {
  return { id, name, logo: null, closedAt: null };
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** The Route Handler, answering with whatever `loadOne` gives for the id. */
function routeHandler(url: string) {
  const projectId = decodeURIComponent(url.split("/").pop() ?? "");
  return Promise.resolve(Response.json({ project: mocks.loadOne(projectId) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(routeHandler));
  localStorage.clear();
  mocks.organizationId.current = "org-a";
  mocks.loadPinned.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useScopeProjects", () => {
  it("never shows the old workspace's projects after a switch", async () => {
    let resolveB: (value: unknown) => void = () => {};
    mocks.load.mockImplementation(
      ({ expectedScope }: { expectedScope: { organizationId: string } }) =>
        expectedScope.organizationId === "org-a"
          ? Promise.resolve({
              projects: [project("a-1", "Alpha")],
              nextCursor: null,
            })
          : new Promise((resolve) => {
              resolveB = resolve;
            }),
    );
    const { result, rerender } = renderHook(
      () => useScopeProjects({ search: "", selectedProjectId: null }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.all).toHaveLength(1));

    mocks.organizationId.current = "org-b";
    rerender();

    // Workspace B is still loading: nothing from A may stay clickable.
    expect(result.current.all).toEqual([]);
    expect(result.current.isPending).toBe(true);
    resolveB({ projects: [project("b-1", "Beta")], nextCursor: null });
    await waitFor(() =>
      expect(result.current.all.map(({ id }) => id)).toEqual(["b-1"]),
    );
  });
});

describe("useSelectedScopeProject", () => {
  it("asks Core for the named project and loads no list", async () => {
    mocks.loadOne.mockReturnValue(project("far-1", "Far Away"));
    const { result } = renderHook(() => useSelectedScopeProject("far-1"), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current?.name).toBe("Far Away"));
    expect(mocks.loadOne).toHaveBeenCalledWith("far-1");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.loadPinned).not.toHaveBeenCalled();
  });

  it("names the workspace view without asking Core", () => {
    const { result } = renderHook(() => useSelectedScopeProject(null), {
      wrapper: wrapper(),
    });

    expect(result.current).toBeNull();
    expect(mocks.loadOne).not.toHaveBeenCalled();
  });
});

describe("useIsUnknownScopeProject", () => {
  it("is true only once Core says the project is not here", async () => {
    mocks.loadOne.mockReturnValue(null);
    const { result } = renderHook(() => useIsUnknownScopeProject("gone-1"), {
      wrapper: wrapper(),
    });

    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("stays false for a project Core knows", async () => {
    mocks.loadOne.mockReturnValue(project("far-1", "Far Away"));
    const { result } = renderHook(
      () => ({
        unknown: useIsUnknownScopeProject("far-1"),
        project: useSelectedScopeProject("far-1"),
      }),
      { wrapper: wrapper() },
    );

    // The same query answered: the name is in, and it is not unknown.
    await waitFor(() => expect(result.current.project?.name).toBe("Far Away"));
    expect(result.current.unknown).toBe(false);
  });
});
