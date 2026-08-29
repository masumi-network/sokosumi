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
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  resolveMemberOrganizationByIdMock,
  listInviteLinksByOrganizationIdMock,
  getWebAppBaseUrlMock,
} = vi.hoisted(() => ({
  resolveMemberOrganizationByIdMock: vi.fn(),
  listInviteLinksByOrganizationIdMock: vi.fn(),
  getWebAppBaseUrlMock: vi.fn(),
}));

vi.mock("@/helpers/organization", () => ({
  resolveMemberOrganizationById: resolveMemberOrganizationByIdMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  organizationInviteLinkRepository: {
    listInviteLinksByOrganizationId: (...args: unknown[]) =>
      listInviteLinksByOrganizationIdMock(...args),
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

const orgId = "org_123";
const NOW = new Date("2026-07-25T12:00:00.000Z");

let mountListInviteLinks: (app: OpenAPIHonoWithAuth) => void;

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
  mountListInviteLinks(app);
  return app;
}

async function getList(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  return createApp(authContext).request(
    `http://localhost/${orgId}/invite-links`,
    { method: "GET" },
  );
}

function liveLink(overrides: Record<string, unknown> = {}) {
  return {
    id: "link_1",
    token: "tok_1",
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
  const module = await import("./get");
  mountListInviteLinks = module.default;
});

describe("GET /organizations/{id}/invite-links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    getWebAppBaseUrlMock.mockReturnValue("https://app.sokosumi.test");
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: orgId },
      role: MemberRole.OWNER,
    });
    listInviteLinksByOrganizationIdMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 401 when unauthenticated", async () => {
    const response = await getList(null);
    expect(response.status).toBe(401);
    expect(listInviteLinksByOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("rejects a coworker/context actor", async () => {
    const response = await getList(COWORKER_AUTH_CONTEXT);
    expect(response.status).toBe(403);
    expect(resolveMemberOrganizationByIdMock).not.toHaveBeenCalled();
    expect(listInviteLinksByOrganizationIdMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is a plain member (not owner/admin)", async () => {
    resolveMemberOrganizationByIdMock.mockRejectedValue(
      forbidden("You must be owner, admin"),
    );

    const response = await getList();
    expect(response.status).toBe(403);
    expect(listInviteLinksByOrganizationIdMock).not.toHaveBeenCalled();
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: orgId,
        userId: "user_123",
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
  });

  it("returns an empty array when the organization has no invite links", async () => {
    const response = await getList();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listInviteLinksByOrganizationIdMock).toHaveBeenCalledWith(
      orgId,
      expect.anything(),
    );
    expect(body.data).toEqual([]);
  });

  it("returns mapped invite-link fields for an admin caller", async () => {
    resolveMemberOrganizationByIdMock.mockResolvedValue({
      organization: { id: orgId },
      role: MemberRole.ADMIN,
    });

    const createdAt = new Date("2026-07-20T12:00:00.000Z");
    const expiresAt = new Date("2026-07-27T12:00:00.000Z");
    const revokedAt = new Date("2026-07-21T12:00:00.000Z");
    listInviteLinksByOrganizationIdMock.mockResolvedValue([
      liveLink({
        id: "link_mapped",
        token: "tok_mapped",
        role: MemberRole.MEMBER,
        createdAt,
        expiresAt,
        revokedAt,
        maxUses: 10,
        useCount: 3,
      }),
    ]);

    const response = await getList();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveMemberOrganizationByIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
      }),
    );
    expect(body.data).toEqual([
      {
        token: "tok_mapped",
        url: "https://app.sokosumi.test/join/tok_mapped",
        role: MemberRole.MEMBER,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        revokedAt: revokedAt.toISOString(),
        maxUses: 10,
        useCount: 3,
      },
    ]);
  });

  it("preserves repository createdAt descending order", async () => {
    const newest = liveLink({
      id: "newest",
      token: "tok_newest",
      createdAt: new Date("2026-07-25T10:00:00.000Z"),
      revokedAt: new Date("2026-07-25T11:00:00.000Z"),
    });
    const middle = liveLink({
      id: "middle",
      token: "tok_middle",
      createdAt: new Date("2026-07-23T12:00:00.000Z"),
      maxUses: 5,
      useCount: 5,
    });
    const oldest = liveLink({
      id: "oldest",
      token: "tok_oldest",
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
    });

    // Repository contract: already sorted by createdAt desc.
    listInviteLinksByOrganizationIdMock.mockResolvedValue([
      newest,
      middle,
      oldest,
    ]);

    const response = await getList();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.map((row: { token: string }) => row.token)).toEqual([
      "tok_newest",
      "tok_middle",
      "tok_oldest",
    ]);
    expect(body.data[0]).toMatchObject({
      token: "tok_newest",
      url: "https://app.sokosumi.test/join/tok_newest",
      createdAt: "2026-07-25T10:00:00.000Z",
    });
  });
});
