import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { forbidden } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { deleteVendorLogoIfOwnedMock, requireVendorAdminOrPlatformAdminMock } =
  vi.hoisted(() => ({
    deleteVendorLogoIfOwnedMock: vi.fn(),
    requireVendorAdminOrPlatformAdminMock: vi.fn(),
  }));

vi.mock("@/lib/blob", () => ({
  deleteVendorLogoIfOwned: (...args: unknown[]) =>
    deleteVendorLogoIfOwnedMock(...args),
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

const vendorId = "01960001-0001-7001-8001-000000000001";
const logoUrl = `https://abc.public.blob.vercel-storage.com/vendors/${vendorId}/logos/logo.png`;

let mountCleanupVendorFiles: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountCleanupVendorFiles(app);
  return app;
}

beforeAll(async () => {
  const module = await import("./post");
  mountCleanupVendorFiles = module.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  requireVendorAdminOrPlatformAdminMock.mockResolvedValue({
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  });
  deleteVendorLogoIfOwnedMock.mockResolvedValue(undefined);
});

describe("POST /vendors/{id}/files/cleanup", () => {
  it("best-effort deletes an owned vendor logo URL", async () => {
    const response = await createApp().request(
      `http://localhost/${vendorId}/files/cleanup`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: logoUrl }),
      },
    );

    expect(response.status).toBe(200);
    expect(requireVendorAdminOrPlatformAdminMock).toHaveBeenCalledWith(
      USER_AUTH_CONTEXT,
      vendorId,
    );
    expect(deleteVendorLogoIfOwnedMock).toHaveBeenCalledWith(logoUrl, vendorId);
    const body = await response.json();
    expect(body.data).toEqual({ ok: true });
  });

  it("returns 403 when the caller is not vendor admin or platform admin", async () => {
    requireVendorAdminOrPlatformAdminMock.mockRejectedValue(
      forbidden("Vendor admin access required"),
    );

    const response = await createApp().request(
      `http://localhost/${vendorId}/files/cleanup`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: logoUrl }),
      },
    );

    expect(response.status).toBe(403);
    expect(deleteVendorLogoIfOwnedMock).not.toHaveBeenCalled();
  });
});
