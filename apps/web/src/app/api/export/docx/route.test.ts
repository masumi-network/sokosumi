import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    getSessionResultMock.mockReset();
    withDocxExportFetchGuardMock.mockReset();
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
  });

  expect(withDocxExportFetchGuardMock).not.toHaveBeenCalled();
});
