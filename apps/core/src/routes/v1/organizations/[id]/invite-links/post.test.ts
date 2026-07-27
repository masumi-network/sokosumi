import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { forbidden } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const {
  resolveMemberOrganizationByIdMock,
  createInviteLinkMock,
  getWebAppBaseUrlMock,
} = vi.hoisted(() => ({
  resolveMemberOrganizationByIdMock: vi.fn(),
  createInviteLinkMock: vi.fn(),
  getWebAppBaseUrlMock: vi.fn(),
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  organizationInviteLinkRepository: {
    createInviteLink: (...args: unknown[]) => createInviteLinkMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getWebAppBaseUrl: () => getWebAppBaseUrlMock(),
  };
});

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "victim_999", organizationId: "org_123" },
};

const ORCHESTRATOR_AUTH_CONTEXT: AuthenticationContext = {
  actor: "orchestrator",
  context: { userId: "user_123", organizationId: "org_123" },
};

const orgId = "org_123";
const NOW = new Date("2026-07-25T12:00:00.000Z");

let mountCreateInviteLink: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountCreateInviteLink(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

async function postCreate(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
  body: Record<string, unknown> = {},
) {
  return createApp(authContext).request(
    `http://localhost/${orgId}/invite-links`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function liveCreatedLink(overrides: Record<string, unknown> = {}) {
  return {
    id: "link_1",
    token: "tok_created",
    organizationId: orgId,
    role: MemberRole.MEMBER,
    createdByUserId: "user_123",
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    maxUses: null,
    useCount: 0,
    ...overrides,
  };
}

beforeAll(async () => {
  const module = await import("./post");
  mountCreateInviteLink = module.default;
});

describe("POST /organizations/{id}/invite-links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    getWebAppBaseUrlMock.mockReturnValue("https://app.sokosumi.test");
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: orgId },
      role: MemberRole.OWNER,
    });
    createInviteLinkMock.mockResolvedValue(liveCreatedLink());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await postCreate(null);
    expect(response.status).toBe(401);
    expect(createInviteLinkMock).not.toHaveBeenCalled();
  });

  it("rejects a coworker/context actor so it cannot mint links as a victim", async () => {
    const response = await postCreate(COWORKER_AUTH_CONTEXT);
    expect(response.status).toBe(403);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
    expect(createInviteLinkMock).not.toHaveBeenCalled();
  });

  it("rejects an orchestrator actor (session-only mutation)", async () => {
    const response = await postCreate(ORCHESTRATOR_AUTH_CONTEXT);
    expect(response.status).toBe(403);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
    expect(createInviteLinkMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is a plain member (not owner/admin)", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      forbidden("You must be owner, admin"),
    );

    const response = await postCreate();
    expect(response.status).toBe(403);
    expect(createInviteLinkMock).not.toHaveBeenCalled();
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: orgId,
        userId: "user_123",
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
  });

  it("creates a MEMBER invite link for an owner with default expiry", async () => {
    const response = await postCreate();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(createInviteLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: orgId,
        role: MemberRole.MEMBER,
        createdByUserId: "user_123",
        maxUses: null,
        expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
      }),
      expect.anything(),
    );
    // Token is server-generated; we only assert the repository received one
    // and that the response URL is built from it.
    const createArgs = createInviteLinkMock.mock.calls[0]?.[0] as {
      token: string;
    };
    expect(createArgs.token).toEqual(expect.any(String));
    expect(createArgs.token.length).toBeGreaterThan(16);

    expect(body.data).toMatchObject({
      token: "tok_created",
      url: "https://app.sokosumi.test/join/tok_created",
      role: MemberRole.MEMBER,
      maxUses: null,
      useCount: 0,
      revokedAt: null,
    });
  });

  it("creates a link for an admin with custom maxUses and expiresInDays", async () => {
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: orgId },
      role: MemberRole.ADMIN,
    });
    createInviteLinkMock.mockResolvedValue(
      liveCreatedLink({
        maxUses: 25,
        expiresAt: new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000),
      }),
    );

    const response = await postCreate(USER_AUTH_CONTEXT, {
      expiresInDays: 14,
      maxUses: 25,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(createInviteLinkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        role: MemberRole.MEMBER,
        maxUses: 25,
        expiresAt: new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000),
      }),
      expect.anything(),
    );
    expect(body.data.maxUses).toBe(25);
  });
});
