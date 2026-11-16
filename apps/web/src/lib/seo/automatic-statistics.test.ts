import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: mocks.session,
}));
vi.mock("@/lib/services/seo.service", () => ({
  seoServiceNoRedirect: { syncStatistics: mocks.sync },
}));

import { POST as projectPost } from "@/api/projects/[projectId]/seo/statistics/route";
import { POST as auditPost } from "@/api/seo/audits/[auditId]/statistics/route";

const OWNER = "39d1c2a6-aade-4322-aed5-3f139a34b127";
const body = {
  provider: "search_console",
  propertyId: "sc-domain:example.com",
  from: "2026-01-01",
  to: "2026-03-31",
  automatic: true,
};
function request(
  input: unknown = body,
  viewer = "owner",
  organization = "personal",
) {
  return new Request("https://web.test/api/seo/statistics", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-seo-viewer": viewer,
      "x-seo-organization": organization,
    },
    body: JSON.stringify(input),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    status: "authenticated",
    session: { user: { id: "owner" }, session: { activeOrganizationId: null } },
  });
  mocks.sync.mockResolvedValue({ metrics: [] });
});

describe("automatic statistics HTTP boundary", () => {
  it.each(["audit", "project"])(
    "forwards automatic %s collection through the authenticated Core service",
    async (kind) => {
      const response =
        kind === "audit"
          ? await auditPost(request(), {
              params: Promise.resolve({ auditId: OWNER }),
            })
          : await projectPost(request(), {
              params: Promise.resolve({ projectId: OWNER }),
            });
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.sync).toHaveBeenCalledWith({ kind, id: OWNER }, body);
    },
  );
  it("rejects a request left over from another workspace before collecting", async () => {
    const response = await auditPost(
      request(body, "owner", "organization:previous"),
      { params: Promise.resolve({ auditId: OWNER }) },
    );
    expect(response.status).toBe(409);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("rejects collection without an authenticated session", async () => {
    mocks.session.mockResolvedValue({ status: "signedOut" });
    const response = await auditPost(request(), {
      params: Promise.resolve({ auditId: OWNER }),
    });
    expect(response.status).toBe(401);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it("does not allow the automatic route to force a fresh collection", async () => {
    const response = await auditPost(request({ ...body, automatic: false }), {
      params: Promise.resolve({ auditId: OWNER }),
    });
    expect(response.status).toBe(400);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
