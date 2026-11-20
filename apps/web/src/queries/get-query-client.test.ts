import { describe, expect, it } from "vitest";
import {
  createQueryClient,
  getQueryClient,
  retireQueryClient,
} from "./get-query-client";

describe("get-query-client", () => {
  it("returns a fresh QueryClient on each call with no shared singleton", () => {
    const first = getQueryClient();
    const second = getQueryClient();

    expect(first).not.toBe(second);
    first.setQueryData(["secret"], "user-a");
    expect(second.getQueryData(["secret"])).toBeUndefined();
  });

  it("cancels in-flight queries and clears query and mutation caches on retire", async () => {
    const client = createQueryClient();
    const pendingFetch = Promise.withResolvers<string>();
    let aborted = false;

    const queryPromise = client.fetchQuery({
      queryKey: ["in-flight"],
      queryFn: ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
        return pendingFetch.promise;
      },
      retry: false,
    });
    client.setQueryData(["cached"], "private-value");

    retireQueryClient(client);

    expect(aborted).toBe(true);
    expect(client.getQueryData(["cached"])).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getMutationCache().getAll()).toHaveLength(0);

    pendingFetch.resolve("late-response");
    await expect(queryPromise).rejects.toThrow();
  });
});
