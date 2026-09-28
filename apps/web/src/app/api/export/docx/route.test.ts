import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOCX_QUEUE_WAIT_TIMEOUT_MS,
  withDocxExportLock,
} from "@/lib/utils/docx-export-lock";
import { ExportLimitError } from "@/lib/utils/export-operation";

const {
  getSessionResultMock,
  withDocxExportFetchGuardMock,
  toDocxMock,
  imagePluginMock,
} = vi.hoisted(() => ({
  getSessionResultMock: vi.fn(),
  withDocxExportFetchGuardMock: vi.fn(),
  toDocxMock: vi.fn(),
  imagePluginMock: vi.fn(
    (_options: {
      cacheConfig: { cacheMode: string; cache: Record<string, unknown> };
    }) => ({}),
  ),
}));

vi.mock("mdast2docx", () => ({
  toDocx: (...args: unknown[]) => toDocxMock(...args),
}));
vi.mock("@m2d/image", () => ({
  imagePlugin: imagePluginMock,
}));
vi.mock("@/lib/services/export.service", () => ({
  withExportOperation: async (
    request: Request,
    operation: (signal: AbortSignal) => Promise<Response>,
  ) => {
    try {
      return await operation(request.signal);
    } catch (error) {
      if (request.signal.aborted)
        return Response.json(
          { error: "Export request canceled" },
          { status: 499 },
        );
      if (error instanceof ExportLimitError)
        return Response.json(
          { error: error.message },
          { status: error.status },
        );
      throw error;
    }
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: (...args: unknown[]) => getSessionResultMock(...args),
}));

/**
 * The route reads the session through the real `route-session` gate, so the
 * mock speaks its Result contract: `ok(null)` is a signed-out browser and an
 * `err` is Core being unreachable. Those two must not share a status.
 */
function mockSession(session: unknown): void {
  getSessionResultMock.mockResolvedValue(ok(session));
}

function mockSessionOutage(reason = "timeout"): void {
  getSessionResultMock.mockResolvedValue(
    err({ path: "/auth/get-session", reason }),
  );
}

vi.mock("@/lib/utils/docx-export-ssrf", () => ({
  MAX_MARKDOWN_BYTES: 1_500_000,
  withDocxExportFetchGuard: (...args: unknown[]) =>
    withDocxExportFetchGuardMock(...args),
}));

vi.mock("@/lib/utils/dom-context", () => ({
  setupDomContext: vi.fn(async () => () => {}),
}));

import { POST } from "./route";

describe("POST /api/export/docx", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    getSessionResultMock.mockReset();
    withDocxExportFetchGuardMock.mockReset();
    toDocxMock.mockReset();
    imagePluginMock.mockClear();
  });

  it("returns 503 when the queue wait expires and never converts later", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const active = withDocxExportLock(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    mockSession({ user: { id: "user-1" } });
    try {
      const responsePromise = POST(
        new Request("http://localhost/api/export/docx", {
          method: "POST",
          body: JSON.stringify({ markdown: "# queued" }),
        }) as never,
      );
      await vi.advanceTimersByTimeAsync(DOCX_QUEUE_WAIT_TIMEOUT_MS);
      const response = await responsePromise;
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Export queue wait expired",
      });
    } finally {
      release();
      await active;
    }
    await withDocxExportLock(async () => {});
    expect(withDocxExportFetchGuardMock).not.toHaveBeenCalled();
  });

  it("rejects canceled requests before conversion", async () => {
    mockSession({ user: { id: "user-1" } });
    const response = await POST(
      new Request("http://localhost/api/export/docx", {
        method: "POST",
        body: JSON.stringify({ markdown: "# canceled" }),
        signal: AbortSignal.abort(),
      }) as never,
    );
    expect(response.status).toBe(499);
    expect(withDocxExportFetchGuardMock).not.toHaveBeenCalled();
  });

  it("keeps normal success and conversion failure responses", async () => {
    mockSession({ user: { id: "user-1" } });
    const request = () =>
      new Request("http://localhost/api/export/docx", {
        method: "POST",
        body: JSON.stringify({ markdown: "# ready" }),
      }) as never;
    withDocxExportFetchGuardMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    expect((await POST(request())).status).toBe(200);
    withDocxExportFetchGuardMock.mockRejectedValue(
      new Error("conversion failed"),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await POST(request())).status).toBe(500);
    } finally {
      log.mockRestore();
    }
  });

  it("returns 401 when unauthenticated and never starts DOCX generation", async () => {
    mockSession(null);

    const response = await POST(
      new Request("http://localhost/api/export/docx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          markdown: "![x](http://169.254.169.254/latest/meta-data/)",
        }),
      }) as never,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(withDocxExportFetchGuardMock).not.toHaveBeenCalled();
  });

  it("returns 503, not 401, when the Core session read fails", async () => {
    mockSessionOutage();

    const response = await POST(
      new Request("http://localhost/api/export/docx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown: "# hi" }),
      }) as never,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toEqual({
      error: "Export unavailable",
      reason: "timeout",
    });
    expect(withDocxExportFetchGuardMock).not.toHaveBeenCalled();
  });
  it.each([
    { markdown: "![x](https://cdn.example/a.png)\n".repeat(21) },
    { markdown: '<img src="https://cdn.example/a.png">\n'.repeat(21) },
    {
      markdown: "![x](https://cdn.example/a.png)\n".repeat(19),
      logoPng: "data:image/png;base64,cG5n",
      kanjiLogoPng: "data:image/png;base64,cG5n",
    },
  ])("returns 413 before converting too many images", async (body) => {
    mockSession({ user: { id: "user-1" } });
    const response = await POST(
      new Request("http://localhost/api/export/docx", {
        method: "POST",
        body: JSON.stringify(body),
      }) as never,
    );
    expect(response.status).toBe(413);
    expect(withDocxExportFetchGuardMock).not.toHaveBeenCalled();
    expect(toDocxMock).not.toHaveBeenCalled();
  });

  it("returns 413 for an aggregate image budget failure", async () => {
    mockSession({ user: { id: "user-1" } });
    withDocxExportFetchGuardMock.mockRejectedValue(
      new ExportLimitError("DOCX remote image bytes exceed limit"),
    );
    const response = await POST(
      new Request("http://localhost/api/export/docx", {
        method: "POST",
        body: JSON.stringify({ markdown: "# test" }),
      }) as never,
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "DOCX remote image bytes exceed limit",
    });
  });

  it("isolates image caches between exports and passes the operation signal", async () => {
    mockSession({ user: { id: "user-1" } });
    toDocxMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    withDocxExportFetchGuardMock.mockImplementation(
      (convert: () => Promise<unknown>) => convert(),
    );
    for (let index = 0; index < 2; index += 1) {
      expect(
        (
          await POST(
            new Request("http://localhost/api/export/docx", {
              method: "POST",
              body: JSON.stringify({ markdown: "# test" }),
            }) as never,
          )
        ).status,
      ).toBe(200);
    }
    expect(imagePluginMock).toHaveBeenCalledTimes(2);
    const first = imagePluginMock.mock.calls[0][0];
    const second = imagePluginMock.mock.calls[1][0];
    expect(first).toEqual({ cacheConfig: { cacheMode: "memory", cache: {} } });
    expect(second.cacheConfig.cache).not.toBe(first.cacheConfig.cache);
    expect(withDocxExportFetchGuardMock.mock.calls[0][1]).toBeInstanceOf(
      AbortSignal,
    );
  });
});
