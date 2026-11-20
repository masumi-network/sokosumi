import {
  focusManager,
  onlineManager,
  type QueryClient,
  useQueryClient,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/queries/get-query-client";

interface SessionSnapshot {
  data: {
    user: { id: string };
    session: {
      id: string;
      userId: string;
      activeOrganizationId: string | null;
    };
  } | null;
  isPending: boolean;
  isRefetching: boolean;
  error: null;
}

const sessionStore = vi.hoisted(() => {
  let snapshot: SessionSnapshot = {
    data: null,
    isPending: false,
    isRefetching: false,
    error: null,
  };
  const listeners = new Set<() => void>();

  return {
    set(next: SessionSnapshot) {
      snapshot = next;
      for (const listener of listeners) {
        listener();
      }
    },
    reset() {
      snapshot = {
        data: null,
        isPending: false,
        isRefetching: false,
        error: null,
      };
      listeners.clear();
    },
    subscribe(onStoreChange: () => void) {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    getSnapshot() {
      return snapshot;
    },
  };
});

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () =>
    useSyncExternalStore(
      sessionStore.subscribe,
      sessionStore.getSnapshot,
      sessionStore.getSnapshot,
    ),
}));

import QueryProvider from "@/contexts/query-provider";
import {
  buildScopedQueryKey,
  PERSONAL_WORKSPACE_SCOPE,
  useScopedInfiniteQuery,
  useScopedMutation,
  useScopedQuery,
} from "./scoped-queries";

function sessionSnapshot(
  userId: string,
  activeOrganizationId: string | null,
): SessionSnapshot {
  return {
    data: {
      user: { id: userId },
      session: {
        id: `session-${userId}`,
        userId,
        activeOrganizationId,
      },
    },
    isPending: false,
    isRefetching: false,
    error: null,
  };
}

describe("scoped-queries", () => {
  beforeEach(() => {
    sessionStore.reset();
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  });

  it("prepends workspace (org, slug override, or personal) and viewer user id to query keys and isolates workspaces", async () => {
    sessionStore.set(sessionSnapshot("user-a", "org-a"));

    let activeClient: QueryClient | undefined;
    const fetchForPersonal = Promise.withResolvers<string>();

    function Reader({ workspace }: { workspace?: string | null }) {
      activeClient = useQueryClient();
      const { data, isPending } = useScopedQuery({
        queryKey: ["api-keys"],
        workspace,
        queryFn: ({ queryKey }) => {
          const [ws] = queryKey;
          if (ws === PERSONAL_WORKSPACE_SCOPE) {
            return fetchForPersonal.promise;
          }
          return Promise.resolve(`keys-for-${ws}`);
        },
      });

      return <div data-testid="keys">{isPending ? "loading" : data}</div>;
    }

    const view = render(
      <QueryProvider>
        <Reader />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("keys")).toHaveTextContent("keys-for-org-a");
    });

    expect(
      activeClient?.getQueryData(
        buildScopedQueryKey({ workspace: "org-a", userId: "user-a" }, [
          "api-keys",
        ]),
      ),
    ).toBe("keys-for-org-a");

    // Switching to personal workspace uses "personal" and never displays org-a data.
    act(() => {
      sessionStore.set(sessionSnapshot("user-a", null));
    });

    expect(screen.getByTestId("keys")).toHaveTextContent("loading");

    await act(async () => {
      fetchForPersonal.resolve("keys-for-personal");
      await fetchForPersonal.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId("keys")).toHaveTextContent("keys-for-personal");
    });
    expect(activeClient?.getQueryData(["personal", "user-a", "api-keys"])).toBe(
      "keys-for-personal",
    );

    // Explicit org slug override takes precedence over the session workspace.
    view.rerender(
      <QueryProvider>
        <Reader workspace="acme-slug" />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("keys")).toHaveTextContent(
        "keys-for-acme-slug",
      );
    });
    expect(
      activeClient?.getQueryData(["acme-slug", "user-a", "api-keys"]),
    ).toBe("keys-for-acme-slug");
  });

  it("does not run scoped queries when signed out", () => {
    const queryFn = vi.fn(() => Promise.resolve("should-not-run"));

    function Reader() {
      const { fetchStatus } = useScopedQuery({
        queryKey: ["signed-out-check"],
        queryFn,
      });
      return <div data-testid="fetch-status">{fetchStatus}</div>;
    }

    render(
      <QueryProvider>
        <Reader />
      </QueryProvider>,
    );

    expect(screen.getByTestId("fetch-status")).toHaveTextContent("idle");
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("applies networkMode always, retry false, and refetchOnWindowFocus false without changing global QueryClient defaults", async () => {
    // Global defaults on createQueryClient remain untouched for existing callers.
    const defaultClient = createQueryClient();
    const globalDefaults = defaultClient.getDefaultOptions().queries;
    expect(globalDefaults?.staleTime).toBe(60 * 1000);
    expect(globalDefaults?.networkMode).toBeUndefined();
    expect(globalDefaults?.retry).toBeUndefined();
    expect(globalDefaults?.refetchOnWindowFocus).toBeUndefined();

    sessionStore.set(sessionSnapshot("user-a", "org-a"));
    onlineManager.setOnline(false);

    const offlineQueryFn = vi.fn(() => Promise.resolve("fetched-offline"));
    const failingQueryFn = vi.fn(() => Promise.reject(new Error("boom")));

    function DefaultsProbe() {
      const offline = useScopedQuery({
        queryKey: ["offline-read"],
        queryFn: offlineQueryFn,
        staleTime: 0,
      });
      const failing = useScopedQuery({
        queryKey: ["failing-read"],
        queryFn: failingQueryFn,
      });

      return (
        <div>
          <span data-testid="offline">{offline.data ?? "pending"}</span>
          <span data-testid="failing">{failing.status}</span>
        </div>
      );
    }

    render(
      <QueryProvider>
        <DefaultsProbe />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("offline")).toHaveTextContent(
        "fetched-offline",
      );
      expect(screen.getByTestId("failing")).toHaveTextContent("error");
    });

    // Ran while offline (networkMode: "always") and failed once (retry: false).
    expect(offlineQueryFn).toHaveBeenCalledTimes(1);
    expect(failingQueryFn).toHaveBeenCalledTimes(1);

    // Focus refetch stays disabled even with staleTime: 0.
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(offlineQueryFn).toHaveBeenCalledTimes(1);
  });

  it("reports onError only while mounted on the current key and never for abandoned reads", async () => {
    sessionStore.set(sessionSnapshot("user-a", "org-a"));

    const onError = vi.fn();
    const firstRead = Promise.withResolvers<string>();
    const secondRead = Promise.withResolvers<string>();
    const unmountedRead = Promise.withResolvers<string>();

    function Screen({ filter }: { filter: string }) {
      const query = useScopedQuery({
        queryKey: ["items", filter],
        queryFn: () => {
          if (filter === "a") return firstRead.promise;
          if (filter === "b") return secondRead.promise;
          return unmountedRead.promise;
        },
        onError,
      });

      return (
        <div>
          <span data-testid="status">{query.status}</span>
          <button type="button" onClick={() => void query.refetch()}>
            Retry
          </button>
        </div>
      );
    }

    const view = render(
      <QueryProvider>
        <Screen filter="a" />
      </QueryProvider>,
    );

    // Switch key from "a" to "b" before "a" rejects.
    view.rerender(
      <QueryProvider>
        <Screen filter="b" />
      </QueryProvider>,
    );

    await act(async () => {
      firstRead.reject(new Error("abandoned-key-a"));
      await Promise.resolve();
    });

    expect(onError).not.toHaveBeenCalled();

    // Reject the active key "b" while mounted: must report once.
    const activeError = new Error("active-key-b");
    await act(async () => {
      secondRead.reject(activeError);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenLastCalledWith(activeError);
    });

    // Switch back to already-failed "a": must not replay the abandoned error.
    view.rerender(
      <QueryProvider>
        <Screen filter="a" />
      </QueryProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledTimes(1);

    // Start read "c", unmount before it rejects: must never toast on another screen.
    view.rerender(
      <QueryProvider>
        <Screen filter="c" />
      </QueryProvider>,
    );
    view.unmount();

    await act(async () => {
      unmountedRead.reject(new Error("abandoned-unmounted"));
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("scopes useScopedInfiniteQuery keys, applies defaults, and guards onError on unmount and key change", async () => {
    sessionStore.set(sessionSnapshot("user-a", "org-a"));
    onlineManager.setOnline(false);

    const onError = vi.fn();
    const page2Deferred = Promise.withResolvers<{
      items: string[];
      nextCursor: string | null;
    }>();
    let activeClient: QueryClient | undefined;

    function InfiniteList({ tab }: { tab: string }) {
      activeClient = useQueryClient();
      const query = useScopedInfiniteQuery({
        queryKey: ["feed", tab],
        initialPageParam: null as string | null,
        queryFn: ({ pageParam }) => {
          if (tab === "other") {
            return Promise.resolve({ items: ["other-1"], nextCursor: null });
          }
          if (pageParam === null) {
            return Promise.resolve({ items: ["p1"], nextCursor: "cursor-2" });
          }
          return page2Deferred.promise;
        },
        getNextPageParam: (page) => page.nextCursor,
        onError,
      });

      const items = query.data?.pages.flatMap((page) => page.items) ?? [];

      return (
        <div>
          <span data-testid="items">{items.join(",") || "empty"}</span>
          <button type="button" onClick={() => void query.fetchNextPage()}>
            More
          </button>
        </div>
      );
    }

    const view = render(
      <QueryProvider>
        <InfiniteList tab="main" />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("items")).toHaveTextContent("p1");
    });
    expect(
      activeClient?.getQueryData(["org-a", "user-a", "feed", "main"]),
    ).toBeDefined();

    // Start page 2, then switch tab before page 2 rejects: must not call onError.
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    view.rerender(
      <QueryProvider>
        <InfiniteList tab="other" />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("items")).toHaveTextContent("other-1");
    });

    await act(async () => {
      page2Deferred.reject(new Error("page-2-abandoned"));
      await Promise.resolve();
    });

    expect(onError).not.toHaveBeenCalled();
  });

  it("useScopedMutation cancels prefix queries before the write, applies success to loaded lists, then invalidates", async () => {
    sessionStore.set(sessionSnapshot("user-a", "org-a"));

    const events: string[] = [];
    const slowRefresh = Promise.withResolvers<string[]>();
    let fetchAttempt = 0;
    let activeClient: QueryClient | undefined;

    function ItemsManager() {
      activeClient = useQueryClient();
      const list = useScopedQuery({
        queryKey: ["items", { page: 1 }],
        queryFn: ({ signal }) => {
          fetchAttempt += 1;
          if (fetchAttempt === 1) {
            return Promise.resolve(["existing"]);
          }
          if (fetchAttempt === 2) {
            signal.addEventListener("abort", () => {
              events.push("query-cancelled");
            });
            return slowRefresh.promise;
          }
          events.push("refetch-after-invalidate");
          return Promise.resolve(["existing", "created-from-server"]);
        },
      });

      const createItem = useScopedMutation({
        queryKeyPrefix: ["items"],
        mutationFn: async (name: string) => {
          events.push("mutation-start");
          return name;
        },
        applySuccess: (previous: string[], created) => {
          events.push("apply-success");
          return [...previous, created];
        },
      });

      return (
        <div>
          <span data-testid="list">{list.data?.join(",") ?? "none"}</span>
          <button type="button" onClick={() => void list.refetch()}>
            Refresh
          </button>
          <button
            type="button"
            onClick={() => createItem.mutate("created-optimistic")}
          >
            Create
          </button>
        </div>
      );
    }

    render(
      <QueryProvider>
        <ItemsManager />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("list")).toHaveTextContent("existing");
    });

    // Start an in-flight read under ["items"] before triggering the write.
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    const invalidateSpy = vi.spyOn(
      activeClient as QueryClient,
      "invalidateQueries",
    );

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(screen.getByTestId("list")).toHaveTextContent(
        "existing,created-from-server",
      );
    });

    expect(events).toEqual([
      "query-cancelled",
      "mutation-start",
      "apply-success",
      "refetch-after-invalidate",
    ]);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["org-a", "user-a", "items"],
    });

    slowRefresh.resolve(["stale-refresh"]);
    await Promise.resolve();
  });

  it("useScopedMutation never marks a failed list as loaded when a write succeeds", async () => {
    sessionStore.set(sessionSnapshot("user-a", "org-a"));

    const applySuccess = vi.fn((previous: string[], created: string) => [
      ...previous,
      created,
    ]);
    const refetchAfterInvalidate = Promise.withResolvers<string[]>();
    let fetchAttempt = 0;

    function FailedListWithCreate() {
      const list = useScopedQuery({
        queryKey: ["items"],
        queryFn: () => {
          fetchAttempt += 1;
          if (fetchAttempt === 1) {
            return Promise.reject(new Error("initial-load-failed"));
          }
          if (fetchAttempt === 2) {
            return refetchAfterInvalidate.promise;
          }
          return Promise.resolve(["server-item-0", "item-1"]);
        },
      });

      const createItem = useScopedMutation({
        queryKeyPrefix: ["items"],
        mutationFn: (name: string) => Promise.resolve(name),
        applySuccess,
      });

      return (
        <div>
          <span data-testid="status">{list.status}</span>
          <span data-testid="data">{list.data?.join(",") ?? "none"}</span>
          <button type="button" onClick={() => createItem.mutate("item-1")}>
            Create
          </button>
          <button type="button" onClick={() => void list.refetch()}>
            Retry
          </button>
        </div>
      );
    }

    render(
      <QueryProvider>
        <FailedListWithCreate />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("error");
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // Invalidation triggers a real refetch; applySuccess is skipped so the
    // failed list is never marked "success" with fabricated data.
    await waitFor(() => {
      expect(fetchAttempt).toBe(2);
    });
    expect(applySuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId("status")).not.toHaveTextContent("success");
    expect(screen.getByTestId("data")).toHaveTextContent("none");

    // If that refetch also fails, the list returns to error with no data.
    await act(async () => {
      refetchAfterInvalidate.reject(new Error("still-failing"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("error");
      expect(screen.getByTestId("data")).toHaveTextContent("none");
    });

    // Only when a real read succeeds does the list become loaded.
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("success");
      expect(screen.getByTestId("data")).toHaveTextContent(
        "server-item-0,item-1",
      );
    });
  });

  it("useScopedMutation applies and invalidates only the workspace active when the write started", async () => {
    sessionStore.set(sessionSnapshot("user-a", "org-a"));

    const writeDeferred = Promise.withResolvers<string>();
    let activeClient: QueryClient | undefined;

    function WorkspaceScopedWrite() {
      activeClient = useQueryClient();
      const list = useScopedQuery({
        queryKey: ["items"],
        queryFn: ({ queryKey }) => Promise.resolve([`initial-${queryKey[0]}`]),
      });

      const createItem = useScopedMutation({
        queryKeyPrefix: ["items"],
        mutationFn: () => writeDeferred.promise,
        applySuccess: (previous: string[], created) => [...previous, created],
      });

      return (
        <div>
          <span data-testid="list">{list.data?.join(",") ?? "loading"}</span>
          <button type="button" onClick={() => createItem.mutate()}>
            Create
          </button>
        </div>
      );
    }

    render(
      <QueryProvider>
        <WorkspaceScopedWrite />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("list")).toHaveTextContent("initial-org-a");
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // Switch to org-b while the org-a write is still in flight.
    act(() => {
      sessionStore.set(sessionSnapshot("user-a", "org-b"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("list")).toHaveTextContent("initial-org-b");
    });

    await act(async () => {
      writeDeferred.resolve("created-in-org-a");
      await writeDeferred.promise;
    });

    // org-b's cache must stay untouched; org-a's entry received the write.
    expect(screen.getByTestId("list")).toHaveTextContent("initial-org-b");
    expect(activeClient?.getQueryData(["org-b", "user-a", "items"])).toEqual([
      "initial-org-b",
    ]);
    expect(activeClient?.getQueryData(["org-a", "user-a", "items"])).toEqual([
      "initial-org-a",
      "created-in-org-a",
    ]);
  });
});
