import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden, notFound, serviceUnavailable } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mountAudience from "./audience/get";
import mountBenchmark from "./benchmark/get";
import mountDiscovery from "./discovery/get";

const mocks = vi.hoisted(() => ({
  audience: vi.fn(),
  benchmark: vi.fn(),
  discovery: vi.fn(),
  beta: vi.fn(),
  delegation: vi.fn(),
  capability: vi.fn(),
  project: vi.fn(),
  member: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findFirst: mocks.project },
    member: { findFirst: mocks.member },
  },
}));
vi.mock("@/services/social-statistics-research.service", () => ({
  readSocialPerformanceAudience: mocks.audience,
  readSocialPerformanceBenchmark: mocks.benchmark,
  readSocialPerformanceDiscovery: mocks.discovery,
}));
vi.mock("@/helpers/social-beta-access", () => ({
  requireSocialBetaAccess: mocks.beta,
}));
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: mocks.delegation,
}));
vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: mocks.capability,
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const postId = "44444444-4444-4444-8444-444444444444";
const url = `http://localhost/${projectId}/social-connections/${connectionId}/statistics`;
const auth: AuthenticationContext = {
  actor: "user",
  userId: "owner",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};
function createApp(actor = auth) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", actor);
    c.set("workspaceContext", {
      workspaceId,
      userId: "owner",
      organizationId: null,
    });
    if (actor.actor === "sokoBot" && actor.scope !== "personal")
      c.set("workspaceContext", null);
    await next();
  });
  mountAudience(app);
  mountBenchmark(app);
  mountDiscovery(app);
  return app;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.beta.mockResolvedValue(undefined);
  mocks.capability.mockResolvedValue(undefined);
  mocks.delegation.mockRejectedValue(forbidden("Delegation required"));
  mocks.audience.mockResolvedValue({ contacts: [], nextCursor: null });
  mocks.benchmark.mockResolvedValue({ posts: [] });
  mocks.discovery.mockResolvedValue({ posts: [] });
  mocks.project.mockResolvedValue({
    id: projectId,
    workspaceId,
    workspace: { userId: "owner", organizationId: null },
  });
});

describe("X statistics research routes", () => {
  it("passes validated recent public discovery filters in the same workspace scope", async () => {
    expect(
      (
        await createApp().request(
          `${url}/discovery?topic=launch&language=en&format=image&minLikes=10&maxFollowers=1000&sort=likes`,
        )
      ).status,
    ).toBe(200);
    expect(mocks.discovery).toHaveBeenCalledWith({
      projectId,
      workspaceId,
      connectionId,
      topic: "launch",
      language: "en",
      format: "image",
      minLikes: 10,
      maxFollowers: 1000,
      sort: "likes",
      limit: 100,
    });
  });
  it("passes validated audience pagination and benchmark handles with workspace and connection scope", async () => {
    const app = createApp();
    expect(
      (
        await app.request(
          `${url}/audience?kind=followers&limit=5&cursor=page_2`,
        )
      ).status,
    ).toBe(200);
    expect(mocks.audience).toHaveBeenCalledWith({
      projectId,
      workspaceId,
      connectionId,
      kind: "followers",
      limit: 5,
      cursor: "page_2",
    });
    expect(
      (await app.request(`${url}/benchmark?username=public_reader`)).status,
    ).toBe(200);
    expect(mocks.benchmark).toHaveBeenCalledWith({
      projectId,
      workspaceId,
      connectionId,
      username: "public_reader",
    });
    expect(
      (await app.request(`${url}/audience?kind=likers&postId=${postId}`))
        .status,
    ).toBe(200);
    expect(mocks.audience).toHaveBeenLastCalledWith({
      projectId,
      workspaceId,
      connectionId,
      kind: "likers",
      postId,
      limit: 100,
    });
  });
  it("rejects excessive limits, arbitrary target URLs and provider cursor URLs before reads", async () => {
    const app = createApp();
    for (const suffix of [
      "audience?limit=101",
      "audience?kind=likers",
      "audience?kind=reposters&postId=789",
      "audience?cursor=https%3A%2F%2Fevil.test",
      "benchmark?username=https%3A%2F%2Fevil.test",
      "benchmark",
      "discovery?topic=from%3Aother",
      "discovery?topic=launch&limit=101",
      "discovery?topic=launch&minFollowers=200&maxFollowers=100",
    ]) {
      expect((await app.request(`${url}/${suffix}`)).status).toBe(422);
    }
    expect(mocks.audience).not.toHaveBeenCalled();
    expect(mocks.benchmark).not.toHaveBeenCalled();
    expect(mocks.discovery).not.toHaveBeenCalled();
  });
  it("checks beta access before any external audience or benchmark read", async () => {
    mocks.beta.mockRejectedValue(forbidden("Social unavailable"));
    const app = createApp();
    for (const suffix of [
      "audience",
      "benchmark?username=public_reader",
      "discovery?topic=launch",
    ])
      expect((await app.request(`${url}/${suffix}`)).status).toBe(403);
    expect(mocks.audience).not.toHaveBeenCalled();
    expect(mocks.benchmark).not.toHaveBeenCalled();
    expect(mocks.discovery).not.toHaveBeenCalled();
  });
  it("requires delegated Coworker authorization and tasks capability", async () => {
    const actor: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "coworker",
      vendorId: "vendor",
      context: { userId: "owner", organizationId: null },
    };
    const app = createApp(actor);
    expect((await app.request(`${url}/audience`)).status).toBe(403);
    expect(mocks.audience).not.toHaveBeenCalled();
    mocks.delegation.mockResolvedValue({
      userId: "owner",
      organizationId: null,
    });
    expect((await app.request(`${url}/audience`)).status).toBe(200);
    expect(mocks.capability).toHaveBeenCalledWith(
      "coworker",
      "tasks",
      expect.anything(),
    );
  });
  describe.each([
    ["audience", "audience"],
    ["benchmark?username=public_reader", "benchmark"],
    ["discovery?topic=launch", "discovery"],
  ] as const)("%s bot access", (suffix, read) => {
    const personalBot: AuthenticationContext = {
      actor: "sokoBot",
      scope: "personal",
      sokoBotId: "bot",
      userId: "owner",
      workspaceId,
      organizationId: null,
    };
    const projectBot: AuthenticationContext = {
      actor: "sokoBot",
      scope: "project",
      sokoBotId: "project-bot",
      userId: null,
      workspaceId,
      organizationId: "organization",
      projectId,
    };
    it("allows a personal bot in an accessible Project", async () => {
      expect(
        (await createApp(personalBot).request(`${url}/${suffix}`)).status,
      ).toBe(200);
      expect(mocks[read]).toHaveBeenCalledWith(
        expect.objectContaining({ projectId, workspaceId, connectionId }),
      );
      expect(mocks.project).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: projectId, workspaceId } }),
      );
      expect(mocks.beta).toHaveBeenCalledWith("owner", expect.anything());
    });

    it("rejects a Project the personal bot's owner cannot access before research", async () => {
      mocks.project.mockResolvedValue({
        id: projectId,
        workspaceId,
        workspace: { userId: "another-owner", organizationId: null },
      });
      expect(
        (await createApp(personalBot).request(`${url}/${suffix}`)).status,
      ).toBe(404);
      expect(mocks[read]).not.toHaveBeenCalled();
    });

    it("allows a project bot's own Project without a user workspace context", async () => {
      expect(
        (await createApp(projectBot).request(`${url}/${suffix}`)).status,
      ).toBe(200);
      expect(mocks[read]).toHaveBeenCalledWith(
        expect.objectContaining({ projectId, workspaceId, connectionId }),
      );
      expect(mocks.project).toHaveBeenCalledWith({
        where: {
          id: projectId,
          workspaceId,
          workspace: {
            organizationId: "organization",
            organization: { slug: "utxo" },
          },
        },
        select: { id: true },
      });
      expect(mocks.beta).not.toHaveBeenCalled();
    });

    it("rejects another Project before research or credential lookup", async () => {
      const otherProjectUrl = url.replace(projectId, postId);
      expect(
        (await createApp(projectBot).request(`${otherProjectUrl}/${suffix}`))
          .status,
      ).toBe(403);
      expect(mocks.project).not.toHaveBeenCalled();
      expect(mocks[read]).not.toHaveBeenCalled();
    });

    it("rejects an unavailable or non-beta project bot scope before research", async () => {
      mocks.project.mockResolvedValue(null);
      expect(
        (await createApp(projectBot).request(`${url}/${suffix}`)).status,
      ).toBe(404);
      expect(mocks[read]).not.toHaveBeenCalled();
    });
  });

  it.each(["api_key", "oauth"] as const)(
    "rejects human %s credentials before beta or provider reads",
    async (authenticationMethod) => {
      for (const suffix of [
        "audience",
        "benchmark?username=public_reader",
        "discovery?topic=launch",
      ])
        expect(
          (
            await createApp({ ...auth, authenticationMethod }).request(
              `${url}/${suffix}`,
            )
          ).status,
        ).toBe(403);
      expect(mocks.beta).not.toHaveBeenCalled();
      expect(mocks.audience).not.toHaveBeenCalled();
      expect(mocks.benchmark).not.toHaveBeenCalled();
      expect(mocks.discovery).not.toHaveBeenCalled();
    },
  );
  it("preserves scoped not-found and explicit provider-unavailable status", async () => {
    mocks.audience.mockRejectedValue(
      notFound("Project social connection not found"),
    );
    mocks.benchmark.mockRejectedValue(
      serviceUnavailable("X public benchmark unavailable"),
    );
    const app = createApp();
    expect((await app.request(`${url}/audience`)).status).toBe(404);
    expect(
      (await app.request(`${url}/benchmark?username=public_reader`)).status,
    ).toBe(503);
  });
});
