import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { ORGANIZATION_LOGO_MAX_SIZE_BYTES } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forbidden,
  formatZodErrorMessage,
  unprocessableEntity,
} from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const {
  getEnvMock,
  createOrganizationLogoUploadSessionMock,
  resolveMemberOrganizationByIdMock,
} = vi.hoisted(() => ({
  getEnvMock: vi.fn(() => ({
    BLOB_READ_WRITE_TOKEN: "blob-token",
  })),
  createOrganizationLogoUploadSessionMock: vi.fn(),
  resolveMemberOrganizationByIdMock: vi.fn(),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      ...getEnvMock(),
    }),
  };
});

vi.mock("@/lib/blob", () => ({
  createOrganizationLogoUploadSession: (...args: unknown[]) =>
    createOrganizationLogoUploadSessionMock(...args),
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

let mountPostOrganizationFiles: (app: OpenAPIHonoWithAuth) => void;

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

  mountPostOrganizationFiles(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

async function postFiles(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
  body: Record<string, unknown> = {
    filename: "logo.png",
    contentType: "image/png",
    size: 12_000,
  },
) {
  return createApp(authContext).request(`http://localhost/${orgId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const module = await import("./post");
  mountPostOrganizationFiles = module.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({
    BLOB_READ_WRITE_TOKEN: "blob-token",
  });
  resolveMemberOrganizationByIdMock.mockResolvedValue({
    organization: { id: orgId },
    role: MemberRole.OWNER,
  });
  createOrganizationLogoUploadSessionMock.mockResolvedValue({
    uploadUrl: "https://blob.example/upload?sig=1",
    access: "public",
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    pathname: "organizations/org_123/logos/logo.png",
    addRandomSuffix: true,
    maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
    expiresAt: "2026-07-30T12:15:00.000Z",
  });
});

describe("POST /organizations/{id}/files", () => {
  it("mints an organization logo upload session for owner/admin", async () => {
    const response = await postFiles();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: orgId,
        userId: "user_123",
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
    expect(createOrganizationLogoUploadSessionMock).toHaveBeenCalledWith(
      orgId,
      {
        filename: "logo.png",
        contentType: "image/png",
        size: 12_000,
        maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
      },
      "blob-token",
    );
    expect(body.data.pathname).toBe("organizations/org_123/logos/logo.png");
  });

  it("returns 403 when the caller is not owner/admin", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      forbidden("You must be owner, admin"),
    );

    const response = await postFiles();
    expect(response.status).toBe(403);
    expect(createOrganizationLogoUploadSessionMock).not.toHaveBeenCalled();
  });

  it("returns 503 when blob storage is not configured", async () => {
    getEnvMock.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: undefined as unknown as string,
    });

    const response = await postFiles();
    expect(response.status).toBe(503);
    expect(createOrganizationLogoUploadSessionMock).not.toHaveBeenCalled();
  });

  it("rejects non-logo MIME types", async () => {
    const response = await postFiles(USER_AUTH_CONTEXT, {
      filename: "notes.pdf",
      contentType: "application/pdf",
      size: 1000,
    });

    expect(response.status).toBe(422);
    expect(createOrganizationLogoUploadSessionMock).not.toHaveBeenCalled();
  });

  it("rejects files over the organization logo size limit", async () => {
    const response = await postFiles(USER_AUTH_CONTEXT, {
      filename: "logo.png",
      contentType: "image/png",
      size: ORGANIZATION_LOGO_MAX_SIZE_BYTES + 1,
    });

    expect(response.status).toBe(422);
    expect(createOrganizationLogoUploadSessionMock).not.toHaveBeenCalled();
  });
});
