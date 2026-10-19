import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";
import mount from "./get";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  beta: vi.fn(),
  delegation: vi.fn(),
  capability: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/services/social-account-statistics.service", () => ({
  listSuggestedPostingTimes: mocks.list,
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

function createApp(actor = auth) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", actor);
    c.set("workspaceContext", workspace);
    await next();
  });
  mount(app);
  return app;
}

function suggestedTimesUrl(timezone = "Europe/Zurich") {
  return `http://localhost/${projectId}/social-connections/${connectionId}/suggested-times?timezone=${encodeURIComponent(timezone)}`;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.beta.mockResolvedValue(undefined);
  mocks.capability.mockResolvedValue(undefined);
  mocks.delegation.mockRejectedValue(forbidden("Delegation required"));
  mocks.list.mockResolvedValue({ hours: [9, 14] });
});

describe("social connection suggested times route", () => {
  it("returns ranked hours for the requested timezone", async () => {
    const response = await createApp().request(suggestedTimesUrl());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { hours: [9, 14] },
    });
    expect(mocks.list).toHaveBeenCalledWith({
      projectId,
      workspaceId,
      connectionId,
      timezone: "Europe/Zurich",
    });
  });

  it("rejects an unknown timezone before reading history", async () => {
    const response = await createApp().request(
      suggestedTimesUrl("Mars/Olympus"),
    );
    expect(response.status).toBe(422);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("rejects beta revocation before reading history", async () => {
    mocks.beta.mockRejectedValue(forbidden("Social unavailable"));
    expect((await createApp().request(suggestedTimesUrl())).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("allows a delegated Coworker and rejects a bare Coworker", async () => {
    const actor: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "coworker",
      vendorId: "vendor",
      context: { userId: "owner", organizationId: null },
    };
    const app = createApp(actor);
    expect((await app.request(suggestedTimesUrl())).status).toBe(403);
    mocks.delegation.mockResolvedValue({
      userId: "owner",
      organizationId: null,
    });
    expect((await app.request(suggestedTimesUrl())).status).toBe(200);
    expect(mocks.capability).toHaveBeenCalledWith(
      "coworker",
      "tasks",
      expect.anything(),
    );
  });

  it("rejects bot REST actors and human API keys", async () => {
    const bot: AuthenticationContext = {
      actor: "sokoBot",
      sokoBotId: "bot",
      userId: "owner",
      workspaceId,
      organizationId: null,
    };
    for (const actor of [
      bot,
      { ...auth, authenticationMethod: "api_key" } as const,
    ]) {
      expect((await createApp(actor).request(suggestedTimesUrl())).status).toBe(
        403,
      );
    }
  });
});
