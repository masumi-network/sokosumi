import {
  dehydrate,
  HydrationBoundary,
  type QueryClient,
  useMutation,
  useQuery,
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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/queries/get-query-client";

interface SessionSnapshot {
  data: {
    user: { id: string };
    session: { id: string; userId: string };
  } | null;
  isPending: boolean;
  isRefetching: boolean;
  error: null;
}

const sessionStore = vi.hoisted(() => {
  let snapshot: SessionSnapshot = {
    data: null,
    isPending: true,
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
        isPending: true,
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

import QueryProvider from "./query-provider";

function signedInSnapshot(
  userId: string,
  options?: { isRefetching?: boolean },
): SessionSnapshot {
  return {
    data: {
      user: { id: userId },
      session: { id: `session-${userId}`, userId },
    },
    isPending: false,
    isRefetching: options?.isRefetching ?? false,
    error: null,
  };
}

const signedOutSnapshot: SessionSnapshot = {
  data: null,
  isPending: false,
  isRefetching: false,
  error: null,
};

describe("QueryProvider", () => {
  beforeEach(() => {
    sessionStore.reset();
  });

  it("hides queries cached as user A after switching to user B", async () => {
    sessionStore.set(signedInSnapshot("user-a"));

    const observedClients: QueryClient[] = [];
    const fetchForB = Promise.withResolvers<string>();
    let fetchCount = 0;

    function PrivateDataReader() {
      const client = useQueryClient();
      if (observedClients.at(-1) !== client) {
        observedClients.push(client);
      }

      const { data, isPending } = useQuery({
        queryKey: ["private-file"],
        queryFn: () => {
          fetchCount += 1;
          if (fetchCount === 1) {
            return Promise.resolve("secret-from-user-a");
          }
          return fetchForB.promise;
        },
        retry: false,
      });

      return <div data-testid="value">{isPending ? "loading" : data}</div>;
    }

    render(
      <QueryProvider>
        <PrivateDataReader />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("value")).toHaveTextContent(
        "secret-from-user-a",
      );
    });

    const clientA = observedClients[0];
    expect(clientA).toBeDefined();
    expect(clientA?.getQueryData(["private-file"])).toBe("secret-from-user-a");

    act(() => {
      sessionStore.set(signedInSnapshot("user-b"));
    });

    // User B must never see user A's cached read, even while B's query is pending.
    expect(screen.getByTestId("value")).toHaveTextContent("loading");
    expect(observedClients).toHaveLength(2);
    const clientB = observedClients[1];
    expect(clientB).not.toBe(clientA);
    expect(clientA?.getQueryCache().getAll()).toHaveLength(0);
    expect(clientB?.getQueryData(["private-file"])).toBeUndefined();

    await act(async () => {
      fetchForB.resolve("secret-from-user-b");
      await fetchForB.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId("value")).toHaveTextContent(
        "secret-from-user-b",
      );
    });
  });

  it("isolates B's cache from a mutation started as A that resolves after switching", async () => {
    sessionStore.set(signedInSnapshot("user-a"));

    const mutationDeferred = Promise.withResolvers<string>();
    let currentClient: QueryClient | undefined;

    function ShareTokenPanel() {
      const queryClient = useQueryClient();
      currentClient = queryClient;

      const { data: token } = useQuery({
        queryKey: ["share-bearer-token"],
        queryFn: () => Promise.resolve("none"),
        staleTime: Number.POSITIVE_INFINITY,
      });

      const createShareLink = useMutation({
        mutationFn: () => mutationDeferred.promise,
        onSuccess: (nextToken) => {
          queryClient.setQueryData(["share-bearer-token"], nextToken);
        },
      });

      return (
        <div>
          <span data-testid="token">{token ?? "empty"}</span>
          <button type="button" onClick={() => createShareLink.mutate()}>
            Create link
          </button>
        </div>
      );
    }

    render(
      <QueryProvider>
        <ShareTokenPanel />
      </QueryProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("token")).toHaveTextContent("none");
    });

    const clientA = currentClient;
    fireEvent.click(screen.getByRole("button", { name: "Create link" }));

    act(() => {
      sessionStore.set(signedInSnapshot("user-b"));
    });

    const clientB = currentClient;
    expect(clientB).toBeDefined();
    expect(clientB).not.toBe(clientA);

    await waitFor(() => {
      expect(screen.getByTestId("token")).toHaveTextContent("none");
    });

    // User A's in-flight mutation finishes after B is active.
    await act(async () => {
      mutationDeferred.resolve("bearer-secret-for-a");
      await mutationDeferred.promise;
    });

    expect(clientB?.getQueryData(["share-bearer-token"])).toBe("none");
    expect(screen.getByTestId("token")).toHaveTextContent("none");
    expect(screen.queryByText("bearer-secret-for-a")).toBeNull();
  });

  it("drops, cancels, and clears the client on sign-out and creates a fresh client on next sign-in", async () => {
    sessionStore.set(signedInSnapshot("user-a"));

    let activeClient: QueryClient | undefined;
    const inFlightQuery = Promise.withResolvers<string>();
    let aborted = false;

    function SessionProbe() {
      const client = useQueryClient();
      activeClient = client;

      useQuery({
        queryKey: ["in-flight-metadata"],
        queryFn: ({ signal }) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return inFlightQuery.promise;
        },
        retry: false,
      });

      return <div data-testid="mounted">ok</div>;
    }

    render(
      <QueryProvider>
        <SessionProbe />
      </QueryProvider>,
    );

    const clientA = activeClient;
    expect(clientA).toBeDefined();
    if (!clientA) throw new Error("expected initial QueryClient");

    clientA.setQueryData(["private-metadata"], { name: "confidential.pdf" });
    const cancelSpy = vi.spyOn(clientA, "cancelQueries");
    const clearSpy = vi.spyOn(clientA, "clear");

    act(() => {
      sessionStore.set(signedOutSnapshot);
    });

    const clientSignedOut = activeClient;
    expect(clientSignedOut).toBeDefined();
    expect(clientSignedOut).not.toBe(clientA);
    expect(cancelSpy).toHaveBeenCalledOnce();
    expect(clearSpy).toHaveBeenCalledOnce();
    expect(aborted).toBe(true);
    expect(clientA.getQueryData(["private-metadata"])).toBeUndefined();
    expect(clientA.getQueryCache().getAll()).toHaveLength(0);
    expect(clientSignedOut?.getQueryData(["private-metadata"])).toBeUndefined();

    // Signing back in (even as the same user) also gets a fresh client.
    act(() => {
      sessionStore.set(signedInSnapshot("user-a"));
    });

    expect(activeClient).not.toBe(clientSignedOut);
    expect(activeClient).not.toBe(clientA);

    inFlightQuery.resolve("stale-metadata");
    await Promise.resolve();
  });

  it("preserves SSR-hydrated data when the initial pending session resolves to user A", () => {
    const serverClient = createQueryClient();
    serverClient.setQueryData(["job", "job-1"], { id: "job-1", owner: "a" });
    const dehydratedState = dehydrate(serverClient);

    let activeClient: QueryClient | undefined;

    function HydratedJobView() {
      const client = useQueryClient();
      activeClient = client;
      const { data } = useQuery<{ id: string; owner: string }>({
        queryKey: ["job", "job-1"],
        queryFn: () => Promise.resolve({ id: "job-1", owner: "refetched" }),
      });

      return <div data-testid="job">{data?.owner ?? "missing"}</div>;
    }

    render(
      <QueryProvider>
        <HydrationBoundary state={dehydratedState}>
          <HydratedJobView />
        </HydrationBoundary>
      </QueryProvider>,
    );

    const bootClient = activeClient;
    expect(screen.getByTestId("job")).toHaveTextContent("a");

    act(() => {
      sessionStore.set(signedInSnapshot("user-a"));
    });

    expect(activeClient).toBe(bootClient);
    expect(screen.getByTestId("job")).toHaveTextContent("a");

    // Same-user background refetch also keeps the client and its cache intact.
    act(() => {
      sessionStore.set(signedInSnapshot("user-a", { isRefetching: true }));
    });

    expect(activeClient).toBe(bootClient);
    expect(screen.getByTestId("job")).toHaveTextContent("a");
  });
});
