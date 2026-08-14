import { beforeEach, describe, expect, it, vi } from "vitest";

const permanentRedirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => permanentRedirectMock(url),
}));

describe("NestedJobRedirectPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("permanent-redirects to /jobs/{jobId}", async () => {
    const { default: NestedJobRedirectPage } = await import("../page");

    await expect(
      NestedJobRedirectPage({
        params: Promise.resolve({
          agentId: "agent-1",
          jobId: "job-1",
        }),
      }),
    ).rejects.toThrow("REDIRECT:/jobs/job-1");

    expect(permanentRedirectMock).toHaveBeenCalledWith("/jobs/job-1");
  });
});
