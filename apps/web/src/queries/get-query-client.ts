import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from "@tanstack/react-query";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
      },
      dehydrate: {
        // include pending queries in dehydration
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
    },
  });
}

/**
 * Cancel in-flight queries before clearing so active fetches receive an abort
 * signal and no cached query or mutation state survives a session boundary.
 */
export function retireQueryClient(client: QueryClient): void {
  void client.cancelQueries();
  client.clear();
}

export function getQueryClient(): QueryClient {
  return createQueryClient();
}
