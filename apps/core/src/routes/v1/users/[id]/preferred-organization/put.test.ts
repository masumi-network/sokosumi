import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountPutUserPreferredOrganization from "./put";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  updatePreferredOrganizationIdMock,
  getMemberByUserIdAndOrganizationIdMock,
  transactionMock,
  userFindUniqueMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  updatePreferredOrganizationIdMock: vi.fn(),
  getMemberByUserIdAndOrganizationIdMock: vi.fn(),
  transactionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: {
    updatePreferredOrganizationId: updatePreferredOrganizationIdMock,
  },
  memberRepository: {
    getMemberByUserIdAndOrganizationId: getMemberByUserIdAndOrganizationIdMock,
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    user: {
      findUnique: userFindUniqueMock,
    },
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
  },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHonoWithAuth();

  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountPutUserPreferredOrganization(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

function putPreferredOrganization(
  app: ReturnType<typeof createApp>,
  pathId: string,
  organizationId: string | null,
) {
  return app.request(`http://localhost/${pathId}/preferred-organization`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
}

describe("PUT /users/{id}/preferred-organization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    transactionMock.mockImplementation(async (callback) => {
      return await callback("tx");
    });
  });

  it("returns 403 when the caller may not access the target user", async () => {
    const response = await putPreferredOrganization(
      createApp(),
      "other_user",
      "org_1",
    );
    expect(response.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(updatePreferredOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("clears the preferred organization without a membership check", async () => {
    workspaceFindUniqueMock.mockResolvedValue({ id: "ws_personal" });
    updatePreferredOrganizationIdMock.mockResolvedValue(undefined);
    const response = await putPreferredOrganization(createApp(), "me", null);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ organizationId: null });
    expect(updatePreferredOrganizationIdMock).toHaveBeenCalledWith(
      "user_123",
      null,
      expect.anything(),
    );
    expect(getMemberByUserIdAndOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("returns 404 when switching to personal without a personal workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValue(null);
    const response = await putPreferredOrganization(createApp(), "me", null);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.kind).toBe("personal_workspace_missing");
    expect(updatePreferredOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("returns 403 with a membership kind when the user is not a member", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(null);
    const response = await putPreferredOrganization(createApp(), "me", "org_1");
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.kind).toBe("organization_membership_required");
    expect(updatePreferredOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("persists the preferred organization inside the membership transaction", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      id: "member_1",
      role: "member",
    });
    updatePreferredOrganizationIdMock.mockResolvedValue(undefined);
    const response = await putPreferredOrganization(createApp(), "me", "org_1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ organizationId: "org_1" });
    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user_123",
      "org_1",
      "tx",
    );
    expect(updatePreferredOrganizationIdMock).toHaveBeenCalledWith(
      "user_123",
      "org_1",
      "tx",
    );
  });
});
