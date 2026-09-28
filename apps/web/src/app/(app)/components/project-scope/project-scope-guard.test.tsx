import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: { current: "/tasks" },
  search: { current: new URLSearchParams() },
  project: { current: null as null | { id: string; name: string } },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  usePathname: () => mocks.pathname.current,
  useSearchParams: () => mocks.search.current,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    },
    isPending: false,
    error: null,
  }),
}));
vi.mock("@/app/projects/actions", () => ({
  loadMoreProjects: vi.fn(),
  loadPinnedProjects: vi.fn(),
}));

import { ProjectScopeGuard } from "./project-scope-guard";

const SELECTED_KEY = "project-scope-selected";

function scopeFetch(url: string) {
  if (!url.startsWith("/api/project-scope/")) {
    return Promise.reject(new Error(`Unexpected fetch ${url}`));
  }
  return Promise.resolve(Response.json({ project: mocks.project.current }));
}

function setPage(pathname: string, search: string) {
  mocks.pathname.current = pathname;
  mocks.search.current = new URLSearchParams(search);
}

function renderWithClient(ui: () => ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>{ui()}</QueryClientProvider>
  );
  const view = render(tree());
  return { client, rerender: () => view.rerender(tree()) };
}

async function selectedQuerySettled(client: QueryClient) {
  await waitFor(() => {
    const [query] = client
      .getQueryCache()
      .findAll({ queryKey: [SELECTED_KEY] });
    expect(query?.state.status).toBe("success");
  });
  // Let the guard's effect run on the settled answer.
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(scopeFetch));
  sessionStorage.clear();
  mocks.project.current = null;
  setPage("/tasks", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProjectScopeGuard", () => {
  it("drops an unknown project from a scoped workspace page", async () => {
    setPage("/tasks", "projectId=p-gone");

    renderWithClient(() => <ProjectScopeGuard />);

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/tasks"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/project-scope/p-gone",
      expect.anything(),
    );
  });

  it("keeps a known project", async () => {
    mocks.project.current = { id: "p-live", name: "Live" };
    setPage("/tasks", "projectId=p-live");

    const { client } = renderWithClient(() => <ProjectScopeGuard />);
    await selectedQuerySettled(client);

    expect(fetch).toHaveBeenCalledWith(
      "/api/project-scope/p-live",
      expect.anything(),
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("leaves a project page alone", async () => {
    setPage("/projects/p-gone", "");

    renderWithClient(() => <ProjectScopeGuard />);
    await act(async () => {});

    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("refreshes the scoped project after a navigation, not on mount", () => {
    setPage("/tasks", "");
    // Spy before the mount, so a mount-time refresh would count.
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const { rerender } = renderWithClient(() => <ProjectScopeGuard />);
    expect(invalidate).not.toHaveBeenCalled();

    rerender();
    expect(invalidate).not.toHaveBeenCalled();

    setPage("/history", "");
    rerender();

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [SELECTED_KEY] });
  });
});
