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
    listSocialStatisticsAudience: mocks.audience,
    getSocialStatisticsBenchmark: mocks.benchmark,
    listSocialStatisticsDiscovery: mocks.discovery,
  },
}));

import { CoreApiRequestError } from "@/lib/clients/core.client";
import { GET } from "./route";

const connectionId = "11111111-1111-4111-8111-111111111111";

function read(resource: string, query = "") {
  return GET(
    new Request(
      `https://web.test/api/projects/p-1/social-statistics/${connectionId}/${resource}${query}`,
    ),
    { params: Promise.resolve({ projectId: "p-1", connectionId, resource }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockResolvedValue({
    status: "authenticated",
    session: { user: { id: "u-1" } },
  });
});

describe("statistics research read", () => {
  it("forwards audience, benchmark, and discovery to Core", async () => {
    mocks.audience.mockResolvedValue({ contacts: [] });
    mocks.benchmark.mockResolvedValue({ posts: [] });
    mocks.discovery.mockResolvedValue({ posts: [] });
    expect((await read("audience", "?kind=followers")).status).toBe(200);
    expect(mocks.audience).toHaveBeenCalledWith("p-1", connectionId, {
      kind: "followers",
    });
    expect((await read("benchmark", "?username=launch")).status).toBe(200);
    expect(mocks.benchmark).toHaveBeenCalledWith("p-1", connectionId, "launch");
    expect((await read("discovery", "?topic=launch")).status).toBe(200);
    expect(mocks.discovery).toHaveBeenCalledWith("p-1", connectionId, {
      topic: "launch",
    });
  });

  it("rejects likers without a cached post and discovery without a query", async () => {
    expect((await read("audience", "?kind=likers")).status).toBe(400);
    expect((await read("discovery")).status).toBe(400);
    expect((await read("benchmark", "?username=https://evil")).status).toBe(
      400,
    );
    expect(mocks.audience).not.toHaveBeenCalled();
    expect(mocks.discovery).not.toHaveBeenCalled();
    expect(mocks.benchmark).not.toHaveBeenCalled();
  });

  it.each(["audience", "benchmark", "discovery"] as const)(
    "preserves %s preview data and disables shared caching",
    async (resource) => {
      const publishedAt = new Date("2026-10-01T12:00:00Z");
      const author = {
        id: "author-1",
        name: "Ada",
        username: "ada",
        avatarUrl: "https://images.test/ada.jpg",
        followersCount: 90,
      };
      const post = {
        id: connectionId,
        externalId: "123",
        text: "Public launch post",
        publishedAt,
        url: "https://x.com/ada/status/123",
        media: [
          {
            kind: "image",
            url: "https://images.test/launch.jpg",
            thumbnailUrl: null,
          },
        ],
        metrics: {
          views: 0,
          impressions: null,
          likes: 5,
          comments: 2,
          shares: 1,
          saves: null,
        },
      };
      const data =
        resource === "benchmark"
          ? {
              profile: author,
              posts: [post],
              observedAt: publishedAt,
              summary: {
                postCount: 1,
                views: 0,
                impressions: null,
                interactions: 8,
              },
              coverage: "Public sample",
            }
          : {
              contacts: [author],
              posts: [{ author, post }],
              nextCursor: "next-sample",
              observedAt: publishedAt,
              coverage: "Public sample",
            };
      mocks[resource].mockResolvedValue(data);
      const query =
        resource === "audience"
          ? `?kind=reposters&postId=${connectionId}&cursor=next-sample&limit=20`
          : resource === "benchmark"
            ? "?username=ada"
            : "?topic=launch&cursor=next-sample";
      const response = await read(resource, query);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual(JSON.parse(JSON.stringify(data)));
      if (resource === "audience")
        expect(mocks.audience).toHaveBeenCalledWith("p-1", connectionId, {
          kind: "reposters",
          postId: connectionId,
          cursor: "next-sample",
          limit: 20,
        });
      if (resource === "discovery")
        expect(mocks.discovery).toHaveBeenCalledWith("p-1", connectionId, {
          topic: "launch",
          cursor: "next-sample",
        });
    },
  );

  it("reports unavailable authentication without treating it as signout", async () => {
    mocks.readSession.mockResolvedValue({
      status: "unavailable",
      reason: "network",
    });
    const response = await read("audience");
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    expect(mocks.audience).not.toHaveBeenCalled();
  });

  it.each(["benchmark", "discovery"] as const)(
    "maps an unknown %s failure to 502",
    async (resource) => {
      mocks[resource].mockRejectedValue(new Error("Unavailable"));
      expect(
        (
          await read(
            resource,
            resource === "benchmark" ? "?username=ada" : "?topic=launch",
          )
        ).status,
      ).toBe(502);
    },
  );

  it("requires a trusted session", async () => {
    mocks.readSession.mockResolvedValue({ status: "signedOut" });
    expect((await read("audience")).status).toBe(401);
    expect(mocks.audience).not.toHaveBeenCalled();
  });

  it("preserves project authorization failures", async () => {
    mocks.audience.mockRejectedValue(
      new CoreApiRequestError("Forbidden", { status: 403 }),
    );
    expect((await read("audience")).status).toBe(403);
  });
});
