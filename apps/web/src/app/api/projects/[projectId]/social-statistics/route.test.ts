import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readSession: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: mocks.readSession,
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { listSocialAccountStatistics: mocks.list },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { GET } from "./route";

function read(query = "") {
  return GET(
    new Request(`https://web.test/api/projects/p-1/social-statistics${query}`),
    { params: Promise.resolve({ projectId: "p-1" }) },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockResolvedValue({
    status: "authenticated",
    session: { user: { id: "u-1" } },
  });
});
describe("statistics read", () => {
  it("forwards validated filters and returns uncached Core data", async () => {
    const data = { posts: [], accounts: [], nextCursor: null };
    mocks.list.mockResolvedValue(data);
    const response = await read(
      "?provider=x&publishedFrom=2026-10-01T00:00:00.000Z&cursor=next",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(data);
    expect(mocks.list).toHaveBeenCalledWith("p-1", {
      provider: "x",
      publishedFrom: "2026-10-01T00:00:00.000Z",
      cursor: "next",
    });
  });
  it("rejects invalid filters before reaching Core", async () => {
    expect((await read("?provider=unknown")).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("requires a trusted session", async () => {
    mocks.readSession.mockResolvedValue({ status: "signedOut" });
    expect((await read()).status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("preserves project authorization failures", async () => {
    mocks.list.mockRejectedValue(
      new CoreApiRequestError("Forbidden", { status: 403 }),
    );
    expect((await read()).status).toBe(403);
  });
  it("reports unavailable authentication without treating it as signout", async () => {
    mocks.readSession.mockResolvedValue({
      status: "unavailable",
      reason: "network",
    });
    expect((await read()).status).toBe(503);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
