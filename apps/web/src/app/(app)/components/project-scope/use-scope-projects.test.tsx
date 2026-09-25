import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("./actions", () => ({ loadScopeProject: mocks.loadOne }));

import {
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.organizationId.current = "org-a";
  mocks.loadPinned.mockResolvedValue([]);
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
    mocks.loadOne.mockResolvedValue(project("far-1", "Far Away"));
    const { result } = renderHook(() => useSelectedScopeProject("far-1"), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current?.name).toBe("Far Away"));
    expect(mocks.loadOne).toHaveBeenCalledWith({ projectId: "far-1" });
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
