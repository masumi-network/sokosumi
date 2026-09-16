import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountGetUserOrganizations from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  userFindUniqueMock,
  memberFindManyMock,
  assertCoworkerUserContextBindingMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  assertCoworkerUserContextBindingMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock },
    member: { findMany: memberFindManyMock },
  },
}));

vi.mock("@/helpers/coworker-user-context-binding", () => ({
  assertCoworkerUserContextBinding: (...args: unknown[]) =>
    assertCoworkerUserContextBindingMock(...args),
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_a",
  role: "user",
};

/** A Serviceplan-style coworker key bound to Workspace A by context headers. */
const COWORKER_IN_ORG_A: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_1",
  vendorId: "vendor_serviceplan",
  context: { userId: "user_123", organizationId: "org_a" },
};

const COWORKER_IN_PERSONAL_WORKSPACE: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_1",
  vendorId: "vendor_serviceplan",
  context: { userId: "user_123", organizationId: null },
};

const SOKO_BOT_IN_ORG_A: AuthenticationContext = {
  actor: "sokoBot",
  sokoBotId: "bot_1",
  userId: "user_123",
  workspaceId: "workspace_a",
  organizationId: "org_a",
};

function memberRow(organizationId: string) {
  return {
    id: `member_${organizationId}`,
    userId: "user_123",
    organizationId,
    role: "member",
    organization: {
      id: organizationId,
      name: organizationId,
      slug: organizationId,
      logo: null,
      metadata: null,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    },
  };
}

function createApp(authContext: AuthenticationContext) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountGetUserOrganizations(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

async function requestOrganizations(authContext: AuthenticationContext) {
  const response = await createApp(authContext).request(
    "http://localhost/me/organizations",
  );
  return { response, body: await response.json() };
}

describe("GET /users/{id}/organizations organization scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    assertCoworkerUserContextBindingMock.mockResolvedValue(undefined);
    memberFindManyMock.mockResolvedValue([memberRow("org_a")]);
  });

  it("returns every membership for a session user", async () => {
    memberFindManyMock.mockResolvedValue([
      memberRow("org_a"),
      memberRow("org_b"),
    ]);

    const { response, body } = await requestOrganizations(SESSION_USER);

    expect(response.status).toBe(200);
    expect(memberFindManyMock).toHaveBeenCalledWith({
      where: { userId: "user_123" },
      include: { organization: true },
    });
    expect(body.data.map((org: { id: string }) => org.id)).toEqual([
      "org_a",
      "org_b",
    ]);
  });

  it("keeps serving the bound organization to a coworker, and only that one", async () => {
    const { response, body } = await requestOrganizations(COWORKER_IN_ORG_A);

    expect(response.status).toBe(200);
    expect(memberFindManyMock).toHaveBeenCalledWith({
      where: { userId: "user_123", organizationId: "org_a" },
      include: { organization: true },
    });
    expect(body.data.map((org: { id: string }) => org.id)).toEqual(["org_a"]);
  });

  it("still applies the coworker grant gate", async () => {
    await requestOrganizations(COWORKER_IN_ORG_A);

    expect(assertCoworkerUserContextBindingMock).toHaveBeenCalledTimes(1);
  });

  it("binds a Soko Bot key to its own workspace organization", async () => {
    await requestOrganizations(SOKO_BOT_IN_ORG_A);

    expect(memberFindManyMock).toHaveBeenCalledWith({
      where: { userId: "user_123", organizationId: "org_a" },
      include: { organization: true },
    });
  });

  it("returns no organization for a personal workspace context", async () => {
    memberFindManyMock.mockResolvedValue([]);

    const { response, body } = await requestOrganizations(
      COWORKER_IN_PERSONAL_WORKSPACE,
    );

    expect(response.status).toBe(200);
    expect(memberFindManyMock).toHaveBeenCalledWith({
      where: { userId: "user_123", organizationId: { in: [] } },
      include: { organization: true },
    });
    expect(body.data).toEqual([]);
  });
});
