import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireExportLease,
  releaseExportLease,
} from "@/lib/clients/generated/core";
import { createClient } from "@/lib/clients/generated/core/client";

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
        onResponseBytes: expect.any(Function),
      },
    );
  });

  it.each(["HTTP://cdn.example/a.png", " HTTPS://cdn.example/a.png "])(
    "applies the guard to normalized remote URL %s",
    async (url) => {
      ssrfSafeFetchMock.mockResolvedValue(new Response("ok"));
      await withDocxExportFetchGuard(async () => {
        await fetch(url);
      });
      expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          maxResponseBytes: MAX_DOCX_IMAGE_BYTES,
          onResponseBytes: expect.any(Function),
        }),
      );
    },
  );

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

  it("keeps concurrent Core admission outside the image guard and budget", async () => {
    const networkFetch = vi.fn(async () =>
      Response.json({
        data: {
          token: "43c46ae9-df3f-4fc2-807b-6b56aaf07384",
          durationMs: 45_000,
          released: true,
        },
        meta: { timestamp: "2026-09-27T00:00:00.000Z" },
      }),
    );
    globalThis.fetch = networkFetch;
    const client = createClient({ baseUrl: "https://core.example" });
    let finish!: () => void;
    const conversion = withDocxExportFetchGuard(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return "document";
    });
    const settledConversion = Promise.allSettled([conversion]);
    const responses = [];
    try {
      for (let index = 0; index < 21; index++) {
        responses.push(await acquireExportLease({ client }));
        responses.push(
          await releaseExportLease({
            client,
            body: { token: "43c46ae9-df3f-4fc2-807b-6b56aaf07384" },
          }),
        );
      }
    } finally {
      finish();
    }
    expect(await settledConversion).toEqual([
      { status: "fulfilled", value: "document" },
    ]);
    expect(responses.every((result) => result.response?.status === 200)).toBe(
      true,
    );
    expect(responses.every((result) => !result.error && result.data)).toBe(
      true,
    );
    expect(networkFetch).toHaveBeenCalledTimes(42);
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(networkFetch);
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
      ).rejects.toMatchObject({ name: "TimeoutError" });

      expect(timeoutSpy).toHaveBeenCalledWith(DOCX_IMAGE_FETCH_TIMEOUT_MS);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("combines a caller signal with the mandatory timeout", async () => {
    ssrfSafeFetchMock.mockResolvedValue(new Response("ok"));
    const controller = new AbortController();

    await withDocxExportFetchGuard(async () => {
      await fetch("https://cdn.example/a.png", { signal: controller.signal });
    });

    const guardedSignal = ssrfSafeFetchMock.mock.calls[0][1].signal;
    expect(guardedSignal).not.toBe(controller.signal);
    controller.abort();
    expect(guardedSignal.aborted).toBe(true);
  });
  it("rejects excess fetch attempts even when the converter swallows errors", async () => {
    ssrfSafeFetchMock.mockResolvedValue(new Response("ok"));
    await expect(
      withDocxExportFetchGuard(async () => {
        await Promise.allSettled(
          Array.from({ length: 21 }, (_, index) =>
            fetch(`https://cdn.example/${index}.png`),
          ),
        );
        return "placeholder document";
      }),
    ).rejects.toMatchObject({
      message: "DOCX image fetch count exceeds limit",
      status: 413,
    });
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(20);
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("accepts the exact shared byte budget across concurrent images", async () => {
    ssrfSafeFetchMock.mockImplementation(async (_url, init) => {
      init.onResponseBytes(5_000_000);
      return new Response("ok");
    });
    await expect(
      withDocxExportFetchGuard(async () => {
        await Promise.all(
          Array.from({ length: 4 }, (_, index) =>
            fetch(`https://cdn.example/${index}.png`),
          ),
        );
        return "document";
      }),
    ).resolves.toBe("document");
  });

  it("rejects excess aggregate bytes and aborts sibling downloads after swallowed errors", async () => {
    const signals: AbortSignal[] = [];
    ssrfSafeFetchMock.mockImplementation(async (_url, init) => {
      signals.push(init.signal);
      init.onResponseBytes(5_000_000);
      return new Response("ok");
    });
    await expect(
      withDocxExportFetchGuard(async () => {
        await Promise.allSettled(
          Array.from({ length: 5 }, (_, index) =>
            fetch(`https://cdn.example/${index}.png`),
          ),
        );
        return "placeholder document";
      }),
    ).rejects.toMatchObject({
      message: "DOCX remote image bytes exceed limit",
      status: 413,
    });
    expect(signals).toHaveLength(5);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("waits for converter cleanup before restoring fetch after deadline", async () => {
    const controller = new AbortController();
    const error = new Error("deadline");
    let finish!: () => void;
    const conversion = withDocxExportFetchGuard(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return "placeholder document";
    }, controller.signal);
    controller.abort(error);
    expect(globalThis.fetch).not.toBe(originalFetch);
    finish();
    await expect(conversion).rejects.toBe(error);
    expect(globalThis.fetch).toBe(originalFetch);
  });
});
