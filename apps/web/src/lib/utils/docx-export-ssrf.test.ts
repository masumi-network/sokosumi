import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ssrfSafeFetchMock } = vi.hoisted(() => ({
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import {
  MAX_DOCX_IMAGE_BYTES,
  withDocxExportFetchGuard,
} from "@/lib/utils/docx-export-ssrf";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("withDocxExportFetchGuard", () => {
  it("routes http(s) image fetches through ssrfSafeFetch with a byte cap", async () => {
    ssrfSafeFetchMock.mockResolvedValue(
      new Response(Buffer.from("png"), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const result = await withDocxExportFetchGuard(async () => {
      const response = await fetch("https://cdn.example/a.png");
      return response.status;
    });

    expect(result).toBe(200);
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      "https://cdn.example/a.png",
      {
        method: "GET",
        maxResponseBytes: MAX_DOCX_IMAGE_BYTES,
      },
    );
  });

  it("rejects blocked private targets from ssrfSafeFetch", async () => {
    ssrfSafeFetchMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      withDocxExportFetchGuard(async () => {
        await fetch("http://169.254.169.254/latest/meta-data/");
      }),
    ).rejects.toThrow("connection refused");

    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      "http://169.254.169.254/latest/meta-data/",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("restores global fetch after the guarded work finishes", async () => {
    ssrfSafeFetchMock.mockResolvedValue(new Response("ok"));

    await withDocxExportFetchGuard(async () => {
      await fetch("https://cdn.example/a.png");
    });

    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("restores global fetch when the guarded work throws", async () => {
    await expect(
      withDocxExportFetchGuard(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(globalThis.fetch).toBe(originalFetch);
  });
});
