import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  loadPinned: vi.fn(),
  loadOne: vi.fn(),
  organizationId: { current: "org-a" },
  userId: { current: "user-1" },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: mocks.userId.current },
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
  SCOPE_SELECTED_QUERY_KEY,
  useIsUnknownScopeProject,
  useScopeProjectReadFailed,
  useScopeProjects,
  useSelectedScopeProject,
} from "./use-scope-projects";

function project(id: string, name: string) {
  return { id, name, logo: null, closedAt: null };
}

function wrapper(
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** The Route Handler failing, as in a Core outage. */
function failingRouteHandler() {
  return Promise.resolve(new Response(null, { status: 502 }));
}

/** The one selected-project read in the cache, as the stale guard sees it. */
function selectedRead(client: QueryClient) {
  const [query] = client
    .getQueryCache()
    .findAll({ queryKey: [SCOPE_SELECTED_QUERY_KEY] });
  if (!query) throw new Error("No selected-project read");
  return query.state;
}

const DEBOUNCE_WAIT = { timeout: 3000 };

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
  mocks.userId.current = "user-1";
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

  it("reports a search Core has not answered yet", async () => {
    let resolveSearch: (value: unknown) => void = () => {};
    mocks.load.mockImplementation(({ query }: { query?: string }) =>
      query
        ? new Promise((resolve) => {
            resolveSearch = resolve;
          })
        : Promise.resolve({
            projects: [project("a-1", "Alpha")],
            nextCursor: null,
          }),
    );
    const { result, rerender } = renderHook(
      ({ search }) => useScopeProjects({ search, selectedProjectId: null }),
      { wrapper: wrapper(), initialProps: { search: "" } },
    );
    await waitFor(() => expect(result.current.all).toHaveLength(1));
    expect(result.current.isSearchPending).toBe(false);

    rerender({ search: "far" });
    // The pause in typing has not ended.
    expect(result.current.isSearchPending).toBe(true);

    await waitFor(
      () =>
        expect(mocks.load).toHaveBeenCalledWith(
          expect.objectContaining({ query: "far" }),
        ),
      DEBOUNCE_WAIT,
    );
    // Core is asked: the rows shown are still the last page's.
    expect(result.current.isPending).toBe(false);
    expect(result.current.isSearchPending).toBe(true);
    expect(result.current.all.map(({ id }) => id)).toEqual(["a-1"]);

    resolveSearch({ projects: [project("far-1", "Far")], nextCursor: null });
    await waitFor(() => expect(result.current.isSearchPending).toBe(false));
    expect(result.current.all.map(({ id }) => id)).toEqual(["far-1"]);
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

  it("keeps the name when a refetch fails", async () => {
    mocks.loadOne.mockReturnValue(project("far-1", "Far Away"));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () => ({
        project: useSelectedScopeProject("far-1"),
        failed: useScopeProjectReadFailed("far-1"),
      }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.project?.name).toBe("Far Away"));

    // The stale guard refetches on navigation; this time Core is down.
    vi.stubGlobal("fetch", vi.fn(failingRouteHandler));
    await client.invalidateQueries({ queryKey: [SCOPE_SELECTED_QUERY_KEY] });

    await waitFor(() => expect(selectedRead(client).status).toBe("error"));
    expect(result.current.project?.name).toBe("Far Away");
    // An answer is in hand, so the triggers need no failure mark.
    expect(result.current.failed).toBe(false);
  });

  it("asks Core again for the same project in another workspace or user", async () => {
    mocks.loadOne.mockImplementation((id: string) =>
      project(id, `${mocks.userId.current} in ${mocks.organizationId.current}`),
    );
    const { result, rerender } = renderHook(
      () => useSelectedScopeProject("p-1"),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current?.name).toBe("user-1 in org-a"));

    mocks.organizationId.current = "org-b";
    rerender();
    await waitFor(() => expect(result.current?.name).toBe("user-1 in org-b"));

    mocks.userId.current = "user-2";
    rerender();
    await waitFor(() => expect(result.current?.name).toBe("user-2 in org-b"));
    expect(mocks.loadOne).toHaveBeenCalledTimes(3);
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

  it("stays true when a refetch fails", async () => {
    mocks.loadOne.mockReturnValue(null);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useIsUnknownScopeProject("gone-1"), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current).toBe(true));

    vi.stubGlobal("fetch", vi.fn(failingRouteHandler));
    await client.invalidateQueries({ queryKey: [SCOPE_SELECTED_QUERY_KEY] });

    await waitFor(() => expect(selectedRead(client).status).toBe("error"));
    expect(result.current).toBe(true);
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

describe("useScopeProjectReadFailed", () => {
  it("is true once the read fails, and not for a null answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url.endsWith("/broken-1")
          ? Promise.resolve(new Response(null, { status: 502 }))
          : routeHandler(url),
      ),
    );
    mocks.loadOne.mockReturnValue(null);
    const { result } = renderHook(
      () => ({
        broken: useScopeProjectReadFailed("broken-1"),
        gone: useScopeProjectReadFailed("gone-1"),
        unknown: useIsUnknownScopeProject("gone-1"),
      }),
      { wrapper: wrapper() },
    );

    expect(result.current.broken).toBe(false);
    await waitFor(() => expect(result.current.broken).toBe(true));
    await waitFor(() => expect(result.current.unknown).toBe(true));
    expect(result.current.gone).toBe(false);
  });
});
