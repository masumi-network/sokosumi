import {
  focusManager,
  keepPreviousData,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getQueryClient } from "@/queries/get-query-client";
import {
  buildScopedQueryKey,
  useScopedInfiniteQuery,
  useScopedQuery,
} from "./scoped-queries";

function createTestClient() {
  return new QueryClient();
}

function renderWithClient(ui: ReactNode, client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("scoped-queries", () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
  });

  it("prepends explicit scope to the query key so a scope change gives a different cache entry", async () => {
    const client = createTestClient();
    const fetchForBeta = Promise.withResolvers<string>();

    function OrgLinks({
      scope,
    }: {
      scope: string | readonly [string, string];
    }) {
      const { data, isPending } = useScopedQuery({
        scope,
        queryKey: ["invite-links"],
        queryFn: () => {
          if (scope === "beta") return fetchForBeta.promise;
          const label = Array.isArray(scope) ? scope.join(":") : scope;
          return Promise.resolve(`links-for-${label}`);
        },
      });

      return <div data-testid="links">{isPending ? "loading" : data}</div>;
    }

    const view = renderWithClient(<OrgLinks scope="acme" />, client);

    await waitFor(() => {
      expect(screen.getByTestId("links")).toHaveTextContent("links-for-acme");
    });
    expect(
      client.getQueryData(buildScopedQueryKey("acme", ["invite-links"])),
    ).toBe("links-for-acme");

    // Switching scope immediately isolates the cache and never shows acme's data.
    view.rerender(
      <QueryClientProvider client={client}>
        <OrgLinks scope="beta" />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId("links")).toHaveTextContent("loading");
    expect(client.getQueryData(["beta", "invite-links"])).toBeUndefined();

    await act(async () => {
      fetchForBeta.resolve("links-for-beta");
      await fetchForBeta.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId("links")).toHaveTextContent("links-for-beta");
    });
    expect(client.getQueryData(["beta", "invite-links"])).toBe(
      "links-for-beta",
    );

    // Composite scopes (workspace + viewer) also map to distinct cache entries.
    const memberScope = ["org-1", "user-a"] as const;
    view.rerender(
      <QueryClientProvider client={client}>
        <OrgLinks scope={memberScope} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("links")).toHaveTextContent(
        "links-for-org-1:user-a",
      );
    });
    expect(
      client.getQueryData(buildScopedQueryKey(memberScope, ["invite-links"])),
    ).toBe("links-for-org-1:user-a");
  });

  it("applies networkMode always, retry false, and refetchOnWindowFocus false without changing global QueryClient defaults", async () => {
    const globalDefaults = getQueryClient().getDefaultOptions().queries;
    expect(globalDefaults?.staleTime).toBe(60 * 1000);
    expect(globalDefaults?.networkMode).toBeUndefined();
    expect(globalDefaults?.retry).toBeUndefined();
    expect(globalDefaults?.refetchOnWindowFocus).toBeUndefined();

    const client = createTestClient();
    onlineManager.setOnline(false);

    const offlineQueryFn = vi.fn(() => Promise.resolve("fetched-offline"));
    const failingQueryFn = vi.fn(() => Promise.reject(new Error("boom")));

    function DefaultsProbe() {
      const offline = useScopedQuery({
        scope: "org-a",
        queryKey: ["offline-read"],
        queryFn: offlineQueryFn,
        staleTime: 0,
      });
      const failing = useScopedQuery({
        scope: "org-a",
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

    renderWithClient(<DefaultsProbe />, client);

    await waitFor(() => {
      expect(screen.getByTestId("offline")).toHaveTextContent(
        "fetched-offline",
      );
      expect(screen.getByTestId("failing")).toHaveTextContent("error");
    });

    expect(offlineQueryFn).toHaveBeenCalledTimes(1);
    expect(failingQueryFn).toHaveBeenCalledTimes(1);

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
    const client = createTestClient();
    const onError = vi.fn();
    const abandonedScopeRead = Promise.withResolvers<string>();
    const activeRead = Promise.withResolvers<string>();
    const unmountedRead = Promise.withResolvers<string>();

    function Screen({ scope }: { scope: string }) {
      const query = useScopedQuery({
        scope,
        queryKey: ["items"],
        queryFn: () => {
          if (scope === "org-a") return abandonedScopeRead.promise;
          if (scope === "org-b") return activeRead.promise;
          return unmountedRead.promise;
        },
        onError,
      });

      return <span data-testid="status">{query.status}</span>;
    }

    const view = renderWithClient(<Screen scope="org-a" />, client);

    // Switch scope from org-a to org-b before org-a rejects.
    view.rerender(
      <QueryClientProvider client={client}>
        <Screen scope="org-b" />
      </QueryClientProvider>,
    );

    await act(async () => {
      abandonedScopeRead.reject(new Error("abandoned-org-a"));
      await Promise.resolve();
    });

    expect(onError).not.toHaveBeenCalled();

    // Reject the active scope org-b while mounted: must report once.
    const activeError = new Error("active-org-b");
    await act(async () => {
      activeRead.reject(activeError);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenLastCalledWith(activeError);
    });

    // Switch back to already-failed org-a: must not replay the abandoned error.
    view.rerender(
      <QueryClientProvider client={client}>
        <Screen scope="org-a" />
      </QueryClientProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(onError).toHaveBeenCalledTimes(1);

    // Start org-c read, unmount before it rejects: must never report on another screen.
    view.rerender(
      <QueryClientProvider client={client}>
        <Screen scope="org-c" />
      </QueryClientProvider>,
    );
    view.unmount();

    await act(async () => {
      unmountedRead.reject(new Error("abandoned-unmounted"));
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("scopes useScopedInfiniteQuery keys, applies defaults, and guards onError on scope change and unmount", async () => {
    const client = createTestClient();
    onlineManager.setOnline(false);

    const onError = vi.fn();
    const page2Deferred = Promise.withResolvers<{
      items: string[];
      nextCursor: string | null;
    }>();

    function InfiniteList({ scope }: { scope: string }) {
      const query = useScopedInfiniteQuery({
        scope,
        queryKey: ["feed"],
        initialPageParam: null as string | null,
        queryFn: ({ pageParam }) => {
          if (scope === "org-b") {
            return Promise.resolve({ items: ["b-1"], nextCursor: null });
          }
          if (pageParam === null) {
            return Promise.resolve({ items: ["a-1"], nextCursor: "cursor-2" });
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

    const view = renderWithClient(<InfiniteList scope="org-a" />, client);

    await waitFor(() => {
      expect(screen.getByTestId("items")).toHaveTextContent("a-1");
    });
    expect(client.getQueryData(["org-a", "feed"])).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    view.rerender(
      <QueryClientProvider client={client}>
        <InfiniteList scope="org-b" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("items")).toHaveTextContent("b-1");
    });

    await act(async () => {
      page2Deferred.reject(new Error("page-2-abandoned"));
      await Promise.resolve();
    });

    expect(onError).not.toHaveBeenCalled();
  });

  it("does not report a shared-key failure to a disabled observer", async () => {
    const client = createTestClient();
    const enabledOnError = vi.fn();
    const disabledOnError = vi.fn();
    const infiniteEnabledOnError = vi.fn();
    const infiniteDisabledOnError = vi.fn();
    const sharedQueryError = new Error("shared-query-failed");
    const sharedInfiniteError = new Error("shared-infinite-failed");

    function SharedObservers() {
      useScopedQuery({
        scope: "org-a",
        queryKey: ["shared"],
        queryFn: () => Promise.reject(sharedQueryError),
        enabled: true,
        onError: enabledOnError,
      });
      useScopedQuery({
        scope: "org-a",
        queryKey: ["shared"],
        queryFn: () => Promise.reject(sharedQueryError),
        enabled: false,
        onError: disabledOnError,
      });

      useScopedInfiniteQuery({
        scope: "org-a",
        queryKey: ["shared-feed"],
        initialPageParam: null as string | null,
        queryFn: () => Promise.reject(sharedInfiniteError),
        getNextPageParam: () => null,
        enabled: true,
        onError: infiniteEnabledOnError,
      });
      useScopedInfiniteQuery({
        scope: "org-a",
        queryKey: ["shared-feed"],
        initialPageParam: null as string | null,
        queryFn: () => Promise.reject(sharedInfiniteError),
        getNextPageParam: () => null,
        enabled: false,
        onError: infiniteDisabledOnError,
      });

      return null;
    }

    renderWithClient(<SharedObservers />, client);

    await waitFor(() => {
      expect(enabledOnError).toHaveBeenCalledTimes(1);
      expect(infiniteEnabledOnError).toHaveBeenCalledTimes(1);
    });
    expect(enabledOnError).toHaveBeenLastCalledWith(sharedQueryError);
    expect(disabledOnError).not.toHaveBeenCalled();
    expect(infiniteEnabledOnError).toHaveBeenLastCalledWith(
      sharedInfiniteError,
    );
    expect(infiniteDisabledOnError).not.toHaveBeenCalled();
  });

  it("never forwards placeholderData / keepPreviousData across scopes", async () => {
    const client = createTestClient();
    const scopeBDeferred = Promise.withResolvers<string>();

    function UntypedCaller({ scope }: { scope: string }) {
      const options = {
        scope,
        queryKey: ["rows"],
        queryFn: () =>
          scope === "org-a"
            ? Promise.resolve("rows-from-a")
            : scopeBDeferred.promise,
        placeholderData: keepPreviousData,
      } as Parameters<typeof useScopedQuery<string>>[0];

      const { data } = useScopedQuery(options);
      return <div data-testid="rows">{data ?? "empty"}</div>;
    }

    const view = renderWithClient(<UntypedCaller scope="org-a" />, client);
    await waitFor(() => {
      expect(screen.getByTestId("rows")).toHaveTextContent("rows-from-a");
    });

    view.rerender(
      <QueryClientProvider client={client}>
        <UntypedCaller scope="org-b" />
      </QueryClientProvider>,
    );

    // Scope A's rows must never render while scope B is loading.
    expect(screen.getByTestId("rows")).toHaveTextContent("empty");

    await act(async () => {
      scopeBDeferred.resolve("rows-from-b");
      await scopeBDeferred.promise;
    });
    await waitFor(() => {
      expect(screen.getByTestId("rows")).toHaveTextContent("rows-from-b");
    });
  });

  it("strips queryHash and queryKeyHashFn so the scope prefix cannot be bypassed", async () => {
    const client = createTestClient();

    function HashBypassProbe({ scope }: { scope: string }) {
      const queryOptions = {
        scope,
        queryKey: ["secret"],
        queryFn: () => Promise.resolve(`query-${scope}`),
        queryHash: "shared-hash",
        queryKeyHashFn: () => "shared-hash",
      } as Parameters<typeof useScopedQuery<string>>[0];

      const infiniteOptions = {
        scope,
        queryKey: ["feed"],
        initialPageParam: null as string | null,
        queryFn: () => Promise.resolve(`page-${scope}`),
        getNextPageParam: () => null,
        queryHash: "shared-infinite-hash",
        queryKeyHashFn: () => "shared-infinite-hash",
      } as Parameters<
        typeof useScopedInfiniteQuery<
          string,
          Error,
          { pages: string[]; pageParams: (string | null)[] },
          string,
          readonly string[],
          string | null
        >
      >[0];

      const query = useScopedQuery(queryOptions);
      const infinite = useScopedInfiniteQuery(infiniteOptions);

      return (
        <div>
          <span data-testid="query">{query.data ?? "loading"}</span>
          <span data-testid="infinite">
            {infinite.data?.pages[0] ?? "loading"}
          </span>
        </div>
      );
    }

    const view = renderWithClient(<HashBypassProbe scope="org-a" />, client);

    await waitFor(() => {
      expect(screen.getByTestId("query")).toHaveTextContent("query-org-a");
      expect(screen.getByTestId("infinite")).toHaveTextContent("page-org-a");
    });

    view.rerender(
      <QueryClientProvider client={client}>
        <HashBypassProbe scope="org-b" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("query")).toHaveTextContent("query-org-b");
      expect(screen.getByTestId("infinite")).toHaveTextContent("page-org-b");
    });

    expect(client.getQueryData(["org-a", "secret"])).toBe("query-org-a");
    expect(client.getQueryData(["org-b", "secret"])).toBe("query-org-b");
    expect(client.getQueryCache().get("shared-hash")).toBeUndefined();
    expect(client.getQueryCache().get("shared-infinite-hash")).toBeUndefined();
  });
});
