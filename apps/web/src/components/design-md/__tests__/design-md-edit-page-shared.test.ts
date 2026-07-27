import { beforeEach, describe, expect, it, vi } from "vitest";

const { ssrfSafeFetchMock } = vi.hoisted(() => ({
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import { fetchDesignMdMarkdown } from "../design-md-edit-page-shared";

describe("fetchDesignMdMarkdown", () => {
  beforeEach(() => {
    ssrfSafeFetchMock.mockReset();
  });

  it("refuses non-blob / non-design-md URLs without fetching", async () => {
    await expect(
      fetchDesignMdMarkdown("https://169.254.169.254/latest/meta-data/"),
    ).resolves.toEqual({ error: true });
    await expect(
      fetchDesignMdMarkdown("https://evil.example/design.md"),
    ).resolves.toEqual({ error: true });
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
  });

  it("fetches allowlisted design-md blob URLs via ssrfSafeFetch", async () => {
    const url =
      "https://abc.public.blob.vercel-storage.com/design-md/content.md";
    ssrfSafeFetchMock.mockResolvedValue(
      new Response("# Hello", { status: 200 }),
    );

    await expect(fetchDesignMdMarkdown(url)).resolves.toEqual({
      markdown: "# Hello",
    });
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(url, {
      maxResponseBytes: 1024 * 1024,
    });
  });

  it("returns error when ssrfSafeFetch rejects or response is not ok", async () => {
    const url =
      "https://abc.public.blob.vercel-storage.com/design-md/content.md";
    ssrfSafeFetchMock.mockRejectedValue(new Error("connection refused"));
    await expect(fetchDesignMdMarkdown(url)).resolves.toEqual({ error: true });

    ssrfSafeFetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(fetchDesignMdMarkdown(url)).resolves.toEqual({ error: true });
  });
});
