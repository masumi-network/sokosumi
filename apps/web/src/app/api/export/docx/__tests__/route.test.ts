import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, withDocxExportFetchGuardMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  withDocxExportFetchGuardMock: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/utils/docx-export-ssrf", () => ({
  MAX_MARKDOWN_BYTES: 1_500_000,
  withDocxExportFetchGuard: (...args: unknown[]) =>
    withDocxExportFetchGuardMock(...args),
}));

vi.mock("@/lib/utils/dom-context", () => ({
  setupDomContext: vi.fn(async () => () => {}),
}));

import { POST } from "../route";

describe("POST /api/export/docx", () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    withDocxExportFetchGuardMock.mockReset();
  });

  it("returns 401 when unauthenticated and never starts DOCX generation", async () => {
    getSessionMock.mockResolvedValue(null);

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
});
