import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionResultMock, installPdfExportRequestGuardMock } = vi.hoisted(
  () => ({
    getSessionResultMock: vi.fn(),
    installPdfExportRequestGuardMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionResult: getSessionResultMock,
}));

vi.mock("@/lib/utils/pdf-export-ssrf", () => ({
  installPdfExportRequestGuard: installPdfExportRequestGuardMock,
}));

import { POST } from "./route";

function request() {
  return POST(
    new Request("http://localhost/api/export/pdf", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html: "<p>hi</p>" }),
    }) as never,
  );
}

describe("POST /api/export/pdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated and never launches a browser", async () => {
    getSessionResultMock.mockResolvedValue(ok(null));

    const response = await request();

    expect(response.status).toBe(401);
    expect(installPdfExportRequestGuardMock).not.toHaveBeenCalled();
  });

  it("returns 503, not 401, when the session read could not reach Core", async () => {
    getSessionResultMock.mockResolvedValue(
      err({ path: "/auth/get-session", reason: "timeout" }),
    );

    const response = await request();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(await response.json()).toEqual({
      error: "Export unavailable",
      reason: "timeout",
    });
    expect(installPdfExportRequestGuardMock).not.toHaveBeenCalled();
  });
});
