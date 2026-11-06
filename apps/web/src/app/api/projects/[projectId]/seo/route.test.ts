import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), getWorkspace: vi.fn() }));
vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: mocks.session,
}));
vi.mock("@/lib/services/seo.service", () => ({
  seoServiceNoRedirect: { getWorkspace: mocks.getWorkspace },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { SEO_VIEWER_HEADER } from "@/lib/seo/owner";
import { GET } from "./route";

const PROJECT = "39d1c2a6-aade-4322-aed5-3f139a34b127";
const PAGE = "2c32dca9-c44f-4372-9114-8c146d5eb30b";
function read(
  query = "",
  expectedViewer: string | null = "owner",
  expectedOrganization: string | null = "personal",
) {
  return GET(
    new Request(`https://web.test/api/projects/${PROJECT}/seo?${query}`, {
      headers: {
        ...(expectedViewer === null
          ? {}
          : { [SEO_VIEWER_HEADER]: expectedViewer }),
        ...(expectedOrganization === null
          ? {}
          : { "x-seo-organization": expectedOrganization }),
      },
    }),
    { params: Promise.resolve({ projectId: PROJECT }) },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    status: "authenticated",
    session: { user: { id: "owner" }, session: { activeOrganizationId: null } },
  });
  mocks.getWorkspace.mockResolvedValue({ projectId: PROJECT });
});
describe("private SEO read boundary", () => {
  it.each([
    ["organization:org-a", "org-b"],
    ["personal", "org-b"],
    ["organization:org-a", null],
    ["personal", "personal"],
    [null, null],
  ])(
    "rejects a stale workspace header %s for the same viewer in %s",
    async (expected, actual) => {
      mocks.session.mockResolvedValue({
        status: "authenticated",
        session: {
          user: { id: "owner" },
          session: { activeOrganizationId: actual },
        },
      });
      expect((await read("", "owner", expected)).status).toBe(409);
      expect(mocks.getWorkspace).not.toHaveBeenCalled();
    },
  );

  it("reads the actual active organization after matching its explicit header", async () => {
    mocks.session.mockResolvedValue({
      status: "authenticated",
      session: {
        user: { id: "owner" },
        session: { activeOrganizationId: "org-b" },
      },
    });
    expect((await read("", "owner", "organization:org-b")).status).toBe(200);
    expect(mocks.getWorkspace).toHaveBeenCalled();
  });

  it("forwards exact page/date filters and disables response caching", async () => {
    const response = await read(`pageId=${PAGE}&from=2026-01-01&to=2026-01-02`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.getWorkspace).toHaveBeenCalledWith(
      { kind: "project", id: PROJECT },
      {
        pageId: PAGE,
        from: "2026-01-01",
        to: "2026-01-02",
      },
    );
  });
  it("refuses ambiguous scope instead of fetching broader data", async () => {
    expect((await read(`pageId=${PAGE}&scopeId=${PROJECT}`)).status).toBe(400);
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
  });
  it.each(["another-owner", null])(
    "refuses private data when the expected viewer is %s",
    async (expectedViewer) => {
      const response = await read("", expectedViewer);
      expect(response.status).toBe(409);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.getWorkspace).not.toHaveBeenCalled();
    },
  );
  it("rejects Core explicit multi-page URL filters rather than dropping them", async () => {
    expect((await read(`pageIds=${PAGE}&pageIds=${PROJECT}`)).status).toBe(400);
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
  });

  it("distinguishes a session outage from signed out and never reads project data", async () => {
    mocks.session.mockResolvedValue({
      status: "unavailable",
      reason: "timeout",
    });
    expect((await read()).status).toBe(503);
    mocks.session.mockResolvedValue({ status: "signedOut" });
    expect((await read()).status).toBe(401);
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
  });
  it("preserves Core's project access rejection", async () => {
    mocks.getWorkspace.mockRejectedValue(
      new CoreApiRequestError("Forbidden", { status: 403 }),
    );
    expect((await read()).status).toBe(403);
  });
});
