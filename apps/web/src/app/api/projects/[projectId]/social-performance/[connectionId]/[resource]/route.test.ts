import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  audience: vi.fn(),
  benchmark: vi.fn(),
  discovery: vi.fn(),
}));
vi.mock("@/lib/auth/route-session", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/route-session")>(
    "@/lib/auth/route-session",
  )),
  readRouteSession: mocks.readSession,
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    listSocialPerformanceAudience: mocks.audience,
    getSocialPerformanceBenchmark: mocks.benchmark,
    listSocialPerformanceDiscovery: mocks.discovery,
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { GET } from "./route";

const connectionId = "11111111-1111-4111-8111-111111111111";
const postId = "22222222-2222-4222-8222-222222222222";
function read(resource: string, query = "") {
  return GET(new Request(`https://web.test/research${query}`), {
    params: Promise.resolve({ projectId: "project-1", connectionId, resource }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockResolvedValue({ status: "authenticated" });
});
describe("performance research reads", () => {
  it("forwards the selected cached post for native likers without caching private data", async () => {
    mocks.audience.mockResolvedValue({ contacts: [] });
    const response = await read(
      "audience",
      `?kind=likers&postId=${postId}&cursor=page2`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.audience).toHaveBeenCalledWith("project-1", connectionId, {
      kind: "likers",
      postId,
      cursor: "page2",
    });
  });
  it("requires a selected post before requesting its audience", async () => {
    expect((await read("audience", "?kind=reposters")).status).toBe(400);
    expect(mocks.audience).not.toHaveBeenCalled();
  });
  it("validates and forwards public sample search filters", async () => {
    mocks.discovery.mockResolvedValue({ posts: [] });
    const response = await read(
      "discovery",
      "?topic=design&language=en&format=video&minLikes=10&maxFollowers=10000&sort=likes&unknown=ignored",
    );
    expect(response.status).toBe(200);
    expect(mocks.discovery).toHaveBeenCalledWith("project-1", connectionId, {
      topic: "design",
      language: "en",
      format: "video",
      minLikes: 10,
      maxFollowers: 10000,
      sort: "likes",
    });
    expect((await read("discovery", "?minLikes=10")).status).toBe(400);
    expect(
      (await read("discovery", "?topic=design&language=invalid")).status,
    ).toBe(400);
  });
  it("requires caller auth and preserves connection authorization errors", async () => {
    mocks.readSession.mockResolvedValueOnce({ status: "signedOut" });
    expect((await read("audience")).status).toBe(401);
    expect(mocks.audience).not.toHaveBeenCalled();
    mocks.benchmark.mockRejectedValue(
      new CoreApiRequestError("Forbidden", { status: 403 }),
    );
    expect((await read("benchmark", "?username=creator")).status).toBe(403);
  });
});
