import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  badGateway,
  forbidden,
  notFound,
  serviceUnavailable,
  tooManyRequests,
  unprocessableEntity,
} from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
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
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));
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
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("requestId", "research-test-request");
    c.set("authContext", actor);
    c.set("workspaceContext", {
      workspaceId,
      userId: "owner",
      organizationId: null,
    });
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
});

describe("X statistics research routes", () => {
  it.each([
    {
      code: "x_access_denied",
      status: 403,
      make: forbidden,
      message:
        "X doesn't give this connection access to followers. Check the X app's plan and endpoint permissions.",
    },
    {
      code: "x_reconnect_required",
      status: 422,
      make: unprocessableEntity,
      message:
        "Reconnect the X account and grant the required permissions to read mentions.",
    },
    {
      code: "x_rate_limited",
      status: 429,
      make: tooManyRequests,
      message: "X is rate limiting mentions. Try again in 90 seconds.",
    },
    {
      code: "x_upstream_error",
      status: 502,
      make: badGateway,
      message:
        "X recent search is unavailable because the connection returned an unexpected response. Try again later.",
    },
    {
      code: "x_upstream_unavailable",
      status: 503,
      make: serviceUnavailable,
      message:
        "X public benchmark data is temporarily unavailable. Try again later.",
    },
  ])(
    "preserves $status/$code and the safe message in the standard error envelope",
    async ({ code, status, make, message }) => {
      const error = make(message, {
        kind: code,
        extensions: { code },
        ...(status === 429 ? { retryAfterSeconds: 90 } : {}),
      });
      mocks.audience.mockRejectedValue(error);
      mocks.benchmark.mockRejectedValue(error);
      mocks.discovery.mockRejectedValue(error);
      for (const suffix of [
        "audience?kind=followers",
        "benchmark?username=reader",
        "discovery?topic=launch",
      ]) {
        const response = await createApp().request(`${url}/${suffix}`);
        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({
          code,
          kind: code,
          message,
          meta: { requestId: "research-test-request" },
          ...(status === 429 ? { retryAfterSeconds: 90 } : {}),
        });
        expect(response.headers.get("retry-after")).toBe(
          status === 429 ? "90" : null,
        );
      }
    },
  );
  it("documents the research failure codes and all upstream HTTP statuses in OpenAPI", () => {
    const doc = createApp().getOpenAPIDocument({
      openapi: "3.1.0",
      info: { title: "test", version: "1" },
    });
    for (const resource of ["audience", "benchmark", "discovery"]) {
      const operation =
        doc.paths?.[
          `/{id}/social-connections/{connectionId}/statistics/${resource}`
        ]?.get;
      expect(Object.keys(operation?.responses ?? {})).toEqual(
        expect.arrayContaining(["403", "422", "429", "502", "503"]),
      );
      expect(
        JSON.stringify(doc.components?.schemas?.SocialStatisticsResearchError),
      ).toContain('"x_rate_limited"');
    }
  });
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
  it("rejects personal and project bot REST actors and human API keys before beta or provider reads", async () => {
    const bot: AuthenticationContext = {
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
    for (const actor of [
      bot,
      projectBot,
      { ...auth, authenticationMethod: "api_key" } as const,
    ]) {
      for (const suffix of [
        "audience",
        "benchmark?username=public_reader",
        "discovery?topic=launch",
      ])
        expect(
          (await createApp(actor).request(`${url}/${suffix}`)).status,
        ).toBe(403);
    }
    expect(mocks.beta).not.toHaveBeenCalled();
    expect(mocks.audience).not.toHaveBeenCalled();
    expect(mocks.benchmark).not.toHaveBeenCalled();
    expect(mocks.discovery).not.toHaveBeenCalled();
  });
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
