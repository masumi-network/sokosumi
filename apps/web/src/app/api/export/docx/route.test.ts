import { err, ok } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DOCX_QUEUE_WAIT_TIMEOUT_MS,
  withDocxExportLock,
} from "@/lib/utils/docx-export-lock";

const { getSessionResultMock, withDocxExportFetchGuardMock } = vi.hoisted(
  () => ({
    getSessionResultMock: vi.fn(),
    withDocxExportFetchGuardMock: vi.fn(),
  }),
);

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

  it("passes request cancellation to the queue", async () => {
    mockSession({ user: { id: "user-1" } });
    const response = await POST(
      new Request("http://localhost/api/export/docx", {
        method: "POST",
        body: JSON.stringify({ markdown: "# canceled" }),
        signal: AbortSignal.abort(),
      }) as never,
    );
    expect(response.status).toBe(503);
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
});
