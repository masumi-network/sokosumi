import { OpenAPIHono } from "@hono/zod-openapi";
import { ORGANIZATION_LOGO_MAX_SIZE_BYTES } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forbidden,
  formatZodErrorMessage,
  notFound,
  unprocessableEntity,
} from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const {
  getEnvMock,
  createVendorLogoUploadSessionMock,
  requireVendorAdminOrPlatformAdminMock,
} = vi.hoisted(() => ({
  getEnvMock: vi.fn(() => ({
    BLOB_READ_WRITE_TOKEN: "blob-token",
  })),
  createVendorLogoUploadSessionMock: vi.fn(),
  requireVendorAdminOrPlatformAdminMock: vi.fn(),
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
  createVendorLogoUploadSession: (...args: unknown[]) =>
    createVendorLogoUploadSessionMock(...args),
}));

vi.mock("@/helpers/vendor-membership", () => ({
  requireVendorAdminOrPlatformAdmin: (...args: unknown[]) =>
    requireVendorAdminOrPlatformAdminMock(...args),
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

const ADMIN_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "admin_123",
  organizationId: null,
  role: "admin",
};

const vendorId = "01960001-0001-7001-8001-000000000001";

let mountPostVendorFiles: (app: OpenAPIHonoWithAuth) => void;

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

  mountPostVendorFiles(app as unknown as OpenAPIHonoWithAuth);
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
  return createApp(authContext).request(`http://localhost/${vendorId}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const module = await import("./post");
  mountPostVendorFiles = module.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({
    BLOB_READ_WRITE_TOKEN: "blob-token",
  });
  requireVendorAdminOrPlatformAdminMock.mockResolvedValue({
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  });
  createVendorLogoUploadSessionMock.mockResolvedValue({
    uploadUrl: "https://blob.example/upload?sig=1",
    access: "public",
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    pathname: `vendors/${vendorId}/logos/logo.png`,
    addRandomSuffix: true,
    maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
    expiresAt: "2026-07-30T12:15:00.000Z",
  });
});

describe("POST /vendors/{id}/files", () => {
  it("mints a vendor logo upload session for vendor admin or platform admin", async () => {
    const response = await postFiles();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(requireVendorAdminOrPlatformAdminMock).toHaveBeenCalledWith(
      USER_AUTH_CONTEXT,
      vendorId,
    );
    expect(createVendorLogoUploadSessionMock).toHaveBeenCalledWith(
      vendorId,
      {
        filename: "logo.png",
        contentType: "image/png",
        size: 12_000,
        maxSizeBytes: ORGANIZATION_LOGO_MAX_SIZE_BYTES,
      },
      "blob-token",
    );
    expect(body.data.pathname).toBe(`vendors/${vendorId}/logos/logo.png`);
  });

  it("allows platform admin through the same gate", async () => {
    requireVendorAdminOrPlatformAdminMock.mockResolvedValue({
      actor: "user",
      userId: "admin_123",
      organizationId: null,
      role: "admin",
    });

    const response = await postFiles(ADMIN_AUTH_CONTEXT);
    expect(response.status).toBe(201);
    expect(requireVendorAdminOrPlatformAdminMock).toHaveBeenCalledWith(
      ADMIN_AUTH_CONTEXT,
      vendorId,
    );
  });

  it("returns 403 when the caller is not vendor admin or platform admin", async () => {
    requireVendorAdminOrPlatformAdminMock.mockRejectedValue(
      forbidden("Vendor admin access required"),
    );

    const response = await postFiles();
    expect(response.status).toBe(403);
    expect(createVendorLogoUploadSessionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the vendor is missing", async () => {
    requireVendorAdminOrPlatformAdminMock.mockRejectedValue(
      notFound("Vendor not found"),
    );

    const response = await postFiles();
    expect(response.status).toBe(404);
    expect(createVendorLogoUploadSessionMock).not.toHaveBeenCalled();
  });

  it("returns 503 when blob storage is not configured", async () => {
    getEnvMock.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: undefined as unknown as string,
    });

    const response = await postFiles();
    expect(response.status).toBe(503);
    expect(createVendorLogoUploadSessionMock).not.toHaveBeenCalled();
  });

  it("rejects non-logo MIME types", async () => {
    const response = await postFiles(USER_AUTH_CONTEXT, {
      filename: "notes.pdf",
      contentType: "application/pdf",
      size: 1000,
    });

    expect(response.status).toBe(422);
    expect(createVendorLogoUploadSessionMock).not.toHaveBeenCalled();
  });

  it("rejects files over the organization logo size limit", async () => {
    const response = await postFiles(USER_AUTH_CONTEXT, {
      filename: "logo.png",
      contentType: "image/png",
      size: ORGANIZATION_LOGO_MAX_SIZE_BYTES + 1,
    });

    expect(response.status).toBe(422);
    expect(createVendorLogoUploadSessionMock).not.toHaveBeenCalled();
  });
});
