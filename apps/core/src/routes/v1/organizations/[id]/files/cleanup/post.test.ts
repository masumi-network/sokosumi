import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forbidden,
  formatZodErrorMessage,
  unprocessableEntity,
} from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const { deleteOrganizationLogoIfOwnedMock, resolveMemberOrganizationByIdMock } =
  vi.hoisted(() => ({
    deleteOrganizationLogoIfOwnedMock: vi.fn(),
    resolveMemberOrganizationByIdMock: vi.fn(),
  }));

vi.mock("@/lib/blob", () => ({
  deleteOrganizationLogoIfOwned: (...args: unknown[]) =>
    deleteOrganizationLogoIfOwnedMock(...args),
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const orgId = "org_123";
const logoUrl =
  "https://abc.public.blob.vercel-storage.com/organizations/org_123/logos/logo.png";

let mountCleanupOrganizationFiles: (app: OpenAPIHonoWithAuth) => void;

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

  mountCleanupOrganizationFiles(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

beforeAll(async () => {
  const module = await import("./post");
  mountCleanupOrganizationFiles = module.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveMemberOrganizationByIdMock.mockResolvedValue({
    organization: { id: orgId },
    role: MemberRole.OWNER,
  });
  deleteOrganizationLogoIfOwnedMock.mockResolvedValue(undefined);
});

describe("POST /organizations/{id}/files/cleanup", () => {
  it("best-effort deletes an owned organization logo URL", async () => {
    const response = await createApp().request(
      `http://localhost/${orgId}/files/cleanup`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: logoUrl }),
      },
    );

    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: orgId,
        userId: "user_123",
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
    expect(deleteOrganizationLogoIfOwnedMock).toHaveBeenCalledWith(
      logoUrl,
      orgId,
    );
  });

  it("returns 403 when the caller is not owner/admin", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      forbidden("You must be owner, admin"),
    );

    const response = await createApp().request(
      `http://localhost/${orgId}/files/cleanup`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: logoUrl }),
      },
    );

    expect(response.status).toBe(403);
    expect(deleteOrganizationLogoIfOwnedMock).not.toHaveBeenCalled();
  });
});
