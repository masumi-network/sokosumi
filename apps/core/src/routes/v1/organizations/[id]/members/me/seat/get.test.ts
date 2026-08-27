import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden, notFound } from "@/helpers/error";
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

const { resolveMemberOrganizationByIdMock, canUseOrganizationWorkstationMock } =
  vi.hoisted(() => ({
    resolveMemberOrganizationByIdMock: vi.fn(),
    canUseOrganizationWorkstationMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

vi.mock("@/helpers/organization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/organization")>()),
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/database/helpers")>()),
  canUseOrganizationWorkstation: canUseOrganizationWorkstationMock,
}));

const { default: mountGetOrganizationCallerSeat } = await import("./get.js");

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
    c.set("requestId", "req_caller_seat_test");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    await next();
  });

  app.onError(errorHandler);
  mountGetOrganizationCallerSeat(app);

  return app;
}

describe("GET /organizations/{id}/members/me/seat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: "org_1" },
      member: { role: "member" },
    });
  });

  it("returns 403 for coworker authentication", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request(
      "http://localhost/org_1/members/me/seat",
    );

    expect(response.status).toBe(403);
    expect(canUseOrganizationWorkstationMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the organization does not exist", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      notFound("Organization not found"),
    );

    const response = await createApp().request(
      "http://localhost/missing/members/me/seat",
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 when the user is not a member", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      forbidden("You are not a member of this organization"),
    );

    const response = await createApp().request(
      "http://localhost/org_1/members/me/seat",
    );

    expect(response.status).toBe(403);
    expect(canUseOrganizationWorkstationMock).not.toHaveBeenCalled();
  });

  it("returns whether the caller is treated as seated", async () => {
    canUseOrganizationWorkstationMock.mockResolvedValue(false);

    const response = await createApp().request(
      "http://localhost/org_1/members/me/seat",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ assigned: false });
    expect(canUseOrganizationWorkstationMock).toHaveBeenCalledWith(
      "user_1",
      "org_1",
      expect.anything(),
    );
  });
});
