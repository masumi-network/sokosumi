import { CoworkerWorkspaceAccessStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type {
  AuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";
import {
  applyUserRouteMiddleware,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  agentCredentials,
  expectPersonApprovalRequired,
} from "@/test-fixtures/person-approval";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  approveMock,
  workspaceFindUniqueMock,
  prismaTransactionMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  approveMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: workspaceFindUniqueMock },
    user: { findUnique: userFindUniqueMock },
    $transaction: prismaTransactionMock,
  },
}));

// usersPathUserContextMiddleware binds coworker→user via grant/baseline;
// stub it so incomplete prisma mocks never 500 a request.
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  assertCoworkerUserContextBinding: vi.fn().mockResolvedValue(undefined),
  requireAuthorizedUserContext: vi.fn(),
}));

vi.mock("@/helpers/coworker-workspace-access", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/helpers/coworker-workspace-access")
    >();
  return {
    ...actual,
    approveCoworkerWorkspaceAccess: (...args: unknown[]) =>
      approveMock(...args),
  };
});

import mountApproveUserCoworkerAccess from "./post";

const SESSION_USER: UserAuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

const accessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const coworkerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const workspaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const now = new Date("2026-08-05T12:00:00.000Z");

function baseAccess(
  overrides: {
    status?: CoworkerWorkspaceAccessStatus;
    resolvedAt?: Date | null;
    resolvedById?: string | null;
  } = {},
) {
  return {
    id: accessId,
    coworkerId,
    coworker: { name: "Ops Pilot", slug: "ops-pilot" },
    workspace: {
      id: "workspace-1",
      userId: null,
      organizationId: "org-1",
      user: null,
      organization: { name: "Acme Corp", slug: "acme-corp" },
    },
    workspaceId,
    status: overrides.status ?? CoworkerWorkspaceAccessStatus.GRANTED,
    requestedByUserId: "requester",
    resolvedAt: overrides.resolvedAt === undefined ? now : overrides.resolvedAt,
    resolvedById:
      overrides.resolvedById === undefined
        ? "user_123"
        : overrides.resolvedById,
    createdAt: now,
    updatedAt: now,
  };
}

function createApp(authContext: AuthenticationContext = SESSION_USER) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  applyUserRouteMiddleware(userByIdApp);
  mountApproveUserCoworkerAccess(userByIdApp);
  app.route("/:id", userByIdApp);
  app.onError(errorHandler);
  return app;
}

describe("POST /users/{id}/coworker-access/{accessId}/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    workspaceFindUniqueMock.mockResolvedValue({ id: workspaceId });
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback({}),
    );
  });

  it("approves PENDING access → 200 GRANTED", async () => {
    approveMock.mockResolvedValue(
      baseAccess({ status: CoworkerWorkspaceAccessStatus.GRANTED }),
    );

    const response = await createApp().request(
      `http://localhost/me/coworker-access/${accessId}/approve`,
      { method: "POST" },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      id: accessId,
      coworkerId,
      coworkerName: "Ops Pilot",
      coworkerSlug: "ops-pilot",
      workspaceId,
      status: "GRANTED",
      resolvedById: "user_123",
    });
    expect(approveMock).toHaveBeenCalledWith(
      {
        accessId,
        workspaceId,
        resolvedById: "user_123",
      },
      {},
    );
  });

  // ADR 0077: an agent may ask for access; a person approves it.
  it.each(agentCredentials(SESSION_USER))(
    "sends %s to the person's account page",
    async (_, authContext) => {
      const response = await createApp(authContext).request(
        `http://localhost/user_123/coworker-access/${accessId}/approve`,
        { method: "POST" },
      );

      await expectPersonApprovalRequired(
        response,
        "https://example.com/account",
      );
      expect(approveMock).not.toHaveBeenCalled();
    },
  );

  it("rejects wrong user path with 403", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "other_user" });

    const response = await createApp().request(
      `http://localhost/other_user/coworker-access/${accessId}/approve`,
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("returns 404 when access not in workspace", async () => {
    approveMock.mockRejectedValue(
      notFound("Coworker workspace access not found"),
    );

    const response = await createApp().request(
      `http://localhost/me/coworker-access/${accessId}/approve`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
  });
});
