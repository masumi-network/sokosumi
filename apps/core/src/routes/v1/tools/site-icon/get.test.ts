import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const { resolveSiteIconAsOrganizationLogoMock } = vi.hoisted(() => ({
  resolveSiteIconAsOrganizationLogoMock: vi.fn(),
}));

vi.mock("@/lib/site-icon", () => ({
  resolveSiteIconAsOrganizationLogo: (...args: unknown[]) =>
    resolveSiteIconAsOrganizationLogoMock(...args),
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

let mountSiteIcon: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>({
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountSiteIcon(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

beforeAll(async () => {
  const module = await import("./get");
  mountSiteIcon = module.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveSiteIconAsOrganizationLogoMock.mockResolvedValue(
    "https://blob.example/organizations/org_123/logos/hash",
  );
});

describe("GET /tools/site-icon", () => {
  it("requires organizationId and passes it to the resolver", async () => {
    const response = await createApp().request(
      "http://localhost/site-icon?url=https://example.com&organizationId=org_123",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveSiteIconAsOrganizationLogoMock).toHaveBeenCalledWith(
      "https://example.com",
      "org_123",
    );
    expect(body.data.url).toBe(
      "https://blob.example/organizations/org_123/logos/hash",
    );
  });

  it("rejects requests missing organizationId", async () => {
    const response = await createApp().request(
      "http://localhost/site-icon?url=https://example.com",
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(resolveSiteIconAsOrganizationLogoMock).not.toHaveBeenCalled();
  });
});
