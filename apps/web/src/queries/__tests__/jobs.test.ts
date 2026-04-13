import { describe, expect, it, vi } from "vitest";
import { type Session } from "@/lib/auth/auth";
import { getJobQueryOptions } from "@/queries/jobs";

vi.mock("superjson", () => ({
  __esModule: true,
  default: {
    parse: (value: unknown) => value,
    stringify: (value: unknown) => value,
  },
}));

describe("getJobQueryOptions", () => {
  it("fetches internal jobs route with credentials included", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const options = getJobQueryOptions("job-1", {
      user: { id: "user-1" },
    } as Session);

    const queryFn = options.queryFn;
    if (!queryFn) {
      throw new Error("queryFn is required");
    }

    await expect(queryFn({} as never)).rejects.toMatchObject({
      message: "Failed to fetch job: Internal Server Error",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/internal/jobs/job-1", {
      credentials: "include",
    });
    expect(options.refetchOnWindowFocus).toBe(false);
  });
});
