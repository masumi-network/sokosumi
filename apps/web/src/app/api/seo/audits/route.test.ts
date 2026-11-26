import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), listAudits: vi.fn() }));
vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: mocks.session,
}));
vi.mock("@/lib/services/seo.service", () => ({
  seoServiceNoRedirect: { listAudits: mocks.listAudits },
}));

import { SEO_VIEWER_HEADER } from "@/lib/seo/owner";
import { GET } from "./route";

const PROJECT = "39d1c2a6-aade-4322-aed5-3f139a34b127";

function read(search: string, viewer = "owner", organization = "personal") {
  return GET(
    new Request(`https://web.test/api/seo/audits${search}`, {
      headers: {
        [SEO_VIEWER_HEADER]: viewer,
        "x-seo-organization": organization,
      },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({
    status: "authenticated",
    session: { user: { id: "owner" }, session: { activeOrganizationId: null } },
  });
  mocks.listAudits.mockResolvedValue({ audits: [], pagination: null });
});

describe("SEO audit list read", () => {
  it("passes the list scope to Core and never caches the answer", async () => {
    const response = await read(
      `?projectId=${PROJECT}&status=archived&cursor=c1`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.listAudits).toHaveBeenCalledWith({
      projectId: PROJECT,
      status: "archived",
      cursor: "c1",
    });
  });

  it("rejects a viewer left over from another organization", async () => {
    const response = await read("", "owner", "organization:org-a");
    expect(response.status).toBe(409);
    expect(mocks.listAudits).not.toHaveBeenCalled();
  });

  it("rejects a project id that is not a uuid", async () => {
    expect((await read("?projectId=nope")).status).toBe(400);
    expect(mocks.listAudits).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    mocks.session.mockResolvedValue({ status: "signedOut" });
    expect((await read("")).status).toBe(401);
  });
});
