import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono.js";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { resolveMemberOrganizationByIdMock, evaluateOrganizationDeletionMock } =
  vi.hoisted(() => ({
    resolveMemberOrganizationByIdMock: vi.fn(),
    evaluateOrganizationDeletionMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

vi.mock("@/helpers/organization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/organization")>()),
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@/helpers/deletion-evaluate", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/deletion-evaluate")>();
  return {
    ...actual,
    evaluateOrganizationDeletion: (...args: unknown[]) =>
      evaluateOrganizationDeletionMock(...args),
  };
});

const { default: mountGetOrganizationDeletion } = await import("./get.js");

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: TEST_VENDOR_ID,
};

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_org_deletion_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    await next();
  });

  app.onError(errorHandler);
  mountGetOrganizationDeletion(app);

  return app;
}

describe("GET /organizations/{id}/deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: "org_1" },
      role: MemberRole.OWNER,
    });
    evaluateOrganizationDeletionMock.mockResolvedValue({ blockers: [] });
  });

  it("returns evaluate blockers for an organization owner", async () => {
    evaluateOrganizationDeletionMock.mockResolvedValue({
      blockers: ["ORGANIZATION_HAS_ADDITIONAL_MEMBERS", "LAST_WORKSPACE"],
    });

    const response = await createApp().request(
      "http://localhost/org_1/deletion",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      blockers: ["ORGANIZATION_HAS_ADDITIONAL_MEMBERS", "LAST_WORKSPACE"],
    });
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "org_1",
        userId: "user_1",
        allowedRoles: [MemberRole.OWNER],
      }),
    );
    expect(evaluateOrganizationDeletionMock).toHaveBeenCalledWith(
      "org_1",
      "user_1",
      expect.anything(),
    );
  });

  it("returns an empty blocker list when evaluate allows deletion", async () => {
    const response = await createApp().request(
      "http://localhost/org_1/deletion",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ blockers: [] });
  });

  it("returns 403 when the caller is not an organization owner", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      forbidden("You must be owner"),
    );

    const response = await createApp().request(
      "http://localhost/org_1/deletion",
    );

    expect(response.status).toBe(403);
    expect(evaluateOrganizationDeletionMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker authentication", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/org_1/deletion",
    );

    expect(response.status).toBe(403);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
    expect(evaluateOrganizationDeletionMock).not.toHaveBeenCalled();
  });
});
