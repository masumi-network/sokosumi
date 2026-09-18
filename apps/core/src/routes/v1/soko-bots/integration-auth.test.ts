import { beforeEach, describe, expect, it, vi } from "vitest";

import { unprocessableEntity } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { SokoBotIntegrationError } from "@/services/soko-bot-integrations.service";

import { mountSokoBotIntegrationAuthRoutes } from "./integration-auth";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { completeMock, finalizeMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
  finalizeMock: vi.fn(),
}));

vi.mock("@/services/soko-bot-integration-auth.service", () => ({
  completeSokoBotIntegrationAuth: completeMock,
}));

vi.mock("@/services/soko-bot-integrations.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/soko-bot-integrations.service")
    >();
  return { ...actual, finalizeSokoBotIntegration: finalizeMock };
});

const USER_ID = "owner_1";
const WORKSPACE_ID = "01960001-0001-7001-8001-000000000010";

/** Mirrors `mapIntegrationError` for the kinds this route can raise. */
function mapError(error: unknown): never {
  if (error instanceof SokoBotIntegrationError) {
    throw unprocessableEntity(error.message);
  }
  throw error;
}

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      organizationId: null,
    });
    return await next();
  });
  mountSokoBotIntegrationAuthRoutes(app, mapError);
  return app;
}

function post(body: unknown) {
  return createApp().request("http://localhost/me/integrations/complete-auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Soko Bot integration callback verifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMock.mockResolvedValue({
      provider: "gmail",
      composioAccountId: "ca_verified",
    });
    finalizeMock.mockResolvedValue("ACTIVE");
  });

  it("redeems the session for the signed-in caller, never for anything in the request", async () => {
    const response = await post({ sessionUri: "session-uri-1" });

    expect(response.status).toBe(200);
    expect(completeMock).toHaveBeenCalledWith({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      sessionUri: "session-uri-1",
    });
  });

  it("promotes only the account Composio verified", async () => {
    await post({ sessionUri: "session-uri-1" });

    expect(finalizeMock).toHaveBeenCalledWith({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      provider: "gmail",
      expectedComposioAccountId: "ca_verified",
    });
  });

  it("does not promote when Composio refuses the identity", async () => {
    completeMock.mockRejectedValue(
      new SokoBotIntegrationError("refused", "IDENTITY_MISMATCH"),
    );

    const response = await post({ sessionUri: "session-uri-1" });

    expect(response.status).toBe(422);
    expect(finalizeMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no session URI", async () => {
    const response = await post({});

    expect(response.status).toBe(422);
    expect(completeMock).not.toHaveBeenCalled();
  });
});
