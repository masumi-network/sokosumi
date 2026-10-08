import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  applyUserRouteMiddleware,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";

import mountGetUserPreferredWorkspace from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { listAuthorizedUserWorkspacesMock, userFindUniqueMock } = vi.hoisted(
  () => ({
    listAuthorizedUserWorkspacesMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
  }),
);

vi.mock("@/helpers/coworker-user-context-binding", () => ({
  assertCoworkerUserContextBinding: vi.fn(),
  listAuthorizedUserWorkspaces: listAuthorizedUserWorkspacesMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: userFindUniqueMock } },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const PERSONAL = {
  id: "11111111-1111-7111-8111-111111111111",
  kind: "personal",
  name: "Ada Lovelace",
  organizationId: null,
  slug: null,
  logo: null,
  websiteUrl: null,
  preferred: false,
} as const;

const ORGANIZATION = {
  id: "22222222-2222-7222-8222-222222222222",
  kind: "organization",
  name: "Acme",
  organizationId: "org_1",
  slug: "acme-x1y2z3",
  logo: null,
  websiteUrl: "https://acme.com",
  preferred: true,
} as const;

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
  applyUserRouteMiddleware(userByIdApp);
  mountGetUserPreferredWorkspace(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

describe("GET /users/{id}/workspaces/preferred", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
  });

  it("returns the workspace the list marks preferred", async () => {
    listAuthorizedUserWorkspacesMock.mockResolvedValue({
      workspaces: [PERSONAL, ORGANIZATION],
      pendingInvitationCount: 0,
    });

    const response = await createApp().request("/me/workspaces/preferred");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).data).toEqual(ORGANIZATION);
    expect(listAuthorizedUserWorkspacesMock).toHaveBeenCalledWith(
      SESSION_USER,
      "user_123",
    );
  });

  it.each([
    ["the user has no workspace", []],
    ["the preferred workspace is hidden from the caller", [PERSONAL]],
  ])(
    "answers 404 no_preferred_workspace when %s",
    async (_label, workspaces) => {
      listAuthorizedUserWorkspacesMock.mockResolvedValue({
        workspaces,
        pendingInvitationCount: 0,
      });

      const response = await createApp().request("/me/workspaces/preferred");

      expect(response.status).toBe(404);
      expect((await response.json()).kind).toBe(
        CORE_API_ERROR_KINDS.NO_PREFERRED_WORKSPACE,
      );
    },
  );
});
