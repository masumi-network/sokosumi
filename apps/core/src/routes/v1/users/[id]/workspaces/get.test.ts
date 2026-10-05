import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserWorkspaces from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  invitationCountMock,
  memberFindManyMock,
  resolveActiveOrganizationIdForSessionMock,
  upsertOrganizationWorkspaceMock,
  userFindUniqueMock,
  workspaceFindUniqueMock,
} = vi.hoisted(() => ({
  invitationCountMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  resolveActiveOrganizationIdForSessionMock: vi.fn(),
  upsertOrganizationWorkspaceMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  workspaceRepository: {
    upsertOrganizationWorkspace: upsertOrganizationWorkspaceMock,
  },
}));

vi.mock("@/services/preferred-organization.service", () => ({
  resolveActiveOrganizationIdForSession:
    resolveActiveOrganizationIdForSessionMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    invitation: { count: invitationCountMock },
    member: { findMany: memberFindManyMock },
    user: { findUnique: userFindUniqueMock },
    workspace: { findUnique: workspaceFindUniqueMock },
  },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const PERSONAL_WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const ORG_WORKSPACE_ID = "22222222-2222-7222-8222-222222222222";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", SESSION_USER);
    return await next();
  });
  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetUserWorkspaces(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({
      id: "user_123",
      name: "Ada Lovelace",
      email: "Ada@Example.com",
    });
    workspaceFindUniqueMock.mockResolvedValue(null);
    memberFindManyMock.mockResolvedValue([]);
    invitationCountMock.mockResolvedValue(0);
    resolveActiveOrganizationIdForSessionMock.mockResolvedValue(null);
  });

  it("returns an empty list with the pending invitation count", async () => {
    invitationCountMock.mockResolvedValue(2);

    const response = await createApp().request("/me/workspaces");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ workspaces: [], pendingInvitationCount: 2 });
    expect(invitationCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        email: { equals: "ada@example.com", mode: "insensitive" },
      }),
    });
  });

  it("lists personal and organization workspaces and marks the preferred one", async () => {
    workspaceFindUniqueMock.mockResolvedValue({ id: PERSONAL_WORKSPACE_ID });
    memberFindManyMock.mockResolvedValue([
      {
        organization: {
          id: "org_1",
          name: "Acme",
          slug: "acme-x1y2z3",
          logo: "https://cdn.example/acme.png",
          metadata: JSON.stringify({ url: "https://acme.com" }),
          workspace: { id: ORG_WORKSPACE_ID },
        },
      },
    ]);
    resolveActiveOrganizationIdForSessionMock.mockResolvedValue("org_1");

    const response = await createApp().request("/me/workspaces");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      workspaces: [
        {
          id: PERSONAL_WORKSPACE_ID,
          kind: "personal",
          name: "Ada Lovelace",
          organizationId: null,
          slug: null,
          logo: null,
          websiteUrl: null,
          preferred: false,
        },
        {
          id: ORG_WORKSPACE_ID,
          kind: "organization",
          name: "Acme",
          organizationId: "org_1",
          slug: "acme-x1y2z3",
          logo: "https://cdn.example/acme.png",
          websiteUrl: "https://acme.com",
          preferred: true,
        },
      ],
      pendingInvitationCount: 0,
    });
  });

  it("marks the personal workspace preferred when no organization resolves", async () => {
    workspaceFindUniqueMock.mockResolvedValue({ id: PERSONAL_WORKSPACE_ID });

    const response = await createApp().request("/me/workspaces");

    const body = await response.json();
    expect(body.data.workspaces).toEqual([
      expect.objectContaining({ id: PERSONAL_WORKSPACE_ID, preferred: true }),
    ]);
  });

  it("creates the missing workspace row of an organization membership", async () => {
    memberFindManyMock.mockResolvedValue([
      {
        organization: {
          id: "org_1",
          name: "Acme",
          slug: "acme-x1y2z3",
          logo: null,
          metadata: null,
          workspace: null,
        },
      },
    ]);
    upsertOrganizationWorkspaceMock.mockResolvedValue({ id: ORG_WORKSPACE_ID });
    resolveActiveOrganizationIdForSessionMock.mockResolvedValue("org_1");

    const response = await createApp().request("/me/workspaces");

    const body = await response.json();
    expect(upsertOrganizationWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_1" }),
    );
    expect(body.data.workspaces).toEqual([
      expect.objectContaining({
        id: ORG_WORKSPACE_ID,
        logo: null,
        websiteUrl: null,
        preferred: true,
      }),
    ]);
  });
});
