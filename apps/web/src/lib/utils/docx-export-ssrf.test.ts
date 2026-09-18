import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ssrfSafeFetchMock } = vi.hoisted(() => ({
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

import {
  DOCX_IMAGE_FETCH_TIMEOUT_MS,
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
        signal: expect.any(AbortSignal),
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

  it("bounds an image fetch that never answers", async () => {
    // A real timeout signal, just a short one: `AbortSignal.timeout` runs on a
    // Node-internal timer that fake timers do not drive.
    const shortTimeout = AbortSignal.timeout(5);
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(shortTimeout);

    try {
      ssrfSafeFetchMock.mockImplementationOnce(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(init.signal.reason),
            );
          }),
      );

      await expect(
        withDocxExportFetchGuard(async () => {
          await fetch("https://slow.example/a.png");
        }),
      ).rejects.toThrow(/timed out/i);

      expect(timeoutSpy).toHaveBeenCalledWith(DOCX_IMAGE_FETCH_TIMEOUT_MS);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("keeps a caller-supplied signal instead of the timeout", async () => {
    ssrfSafeFetchMock.mockResolvedValue(new Response("ok"));
    const controller = new AbortController();

    await withDocxExportFetchGuard(async () => {
      await fetch("https://cdn.example/a.png", { signal: controller.signal });
    });

    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      "https://cdn.example/a.png",
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
