import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import mount from "./get";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  resolve: vi.fn(),
  beta: vi.fn(),
  delegation: vi.fn(),
  capability: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { projectSocialConnection: { findFirst: mocks.find } },
}));
vi.mock("@/services/x-subscription-tier.service", () => ({
  resolveXSubscriptionType: mocks.resolve,
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
const auth: AuthenticationContext = {
  actor: "user",
  userId: "owner",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};
const workspace: WorkspaceContext = {
  workspaceId,
  userId: "owner",
  organizationId: null,
};
const connection = {
  id: connectionId,
  projectId,
  provider: "x",
  composioConnectedAccountId: "ca_123",
  subscriptionType: null,
};

function createApp() {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", auth);
    c.set("workspaceContext", workspace);
    await next();
  });
  mount(app);
  return app;
}
const url = `http://localhost/${projectId}/social-connections/${connectionId}/subscription`;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue(connection);
  mocks.resolve.mockResolvedValue("Basic");
  mocks.beta.mockResolvedValue(undefined);
  mocks.delegation.mockRejectedValue(forbidden("Delegation required"));
});

describe("social connection subscription route", () => {
  it.each([
    ["Basic", 25000],
    ["Premium", 25000],
    ["None", 280],
    [null, 280],
  ])(
    "returns the refreshed %s tier and its limit",
    async (subscriptionType, textLimit) => {
      mocks.resolve.mockResolvedValue(subscriptionType);
      const response = await createApp().request(url);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: { subscriptionType, textLimit },
      });
      expect(mocks.resolve).toHaveBeenCalledWith(connection);
      expect(mocks.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: connectionId,
            projectId,
            project: { workspaceId },
            status: { not: "disconnected" },
          },
        }),
      );
    },
  );

  it("returns 404 for a missing, disconnected, or out-of-workspace connection", async () => {
    mocks.find.mockResolvedValue(null);
    expect((await createApp().request(url)).status).toBe(404);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("checks Calendar beta access before reading or refreshing the account", async () => {
    mocks.beta.mockRejectedValue(forbidden("Social unavailable"));
    expect((await createApp().request(url)).status).toBe(403);
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("publishes the GET contract with coworker context headers", () => {
    const document = createApp().getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "test", version: "1" },
    });
    const operation =
      document.paths?.["/{id}/social-connections/{connectionId}/subscription"]
        ?.get;
    expect(operation?.responses?.["200"]).toBeDefined();
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        { $ref: "#/components/parameters/ContextUserId" },
      ]),
    );
  });
});
