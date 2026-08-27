import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetOrganizationMembers from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  organizationFindUniqueMock,
  memberFindUniqueMock,
  getMembersWithUserAndLastSeenMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  getMembersWithUserAndLastSeenMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMembersWithUserAndLastSeen: (...args: unknown[]) =>
      getMembersWithUserAndLastSeenMock(...args),
  },
}));

const ORG_ID = "org_123";
const USER_ID = "user_123";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_get_org_members");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountGetOrganizationMembers(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

function member() {
  return {
    id: "member_123",
    organizationId: ORG_ID,
    role: MemberRole.MEMBER,
    seatAssignedAt: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    user: {
      id: USER_ID,
      name: "Jane Doe",
      email: "jane@example.com",
      image: null,
    },
    lastSeenAt: new Date("2025-06-08T14:30:00.000Z"),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  getMembersWithUserAndLastSeenMock.mockResolvedValue([member()]);
});

describe("GET /organizations/{id}/members", () => {
  it("lists members without opening an interactive transaction", async () => {
    const response = await createApp(userAuthContext).request(
      `/${ORG_ID}/members`,
    );

    expect(response.status).toBe(200);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(organizationFindUniqueMock).toHaveBeenCalledOnce();
    expect(memberFindUniqueMock).toHaveBeenCalledOnce();
    expect(getMembersWithUserAndLastSeenMock).toHaveBeenCalledOnce();
    expect(getMembersWithUserAndLastSeenMock).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({
        organization: expect.any(Object),
        member: expect.any(Object),
      }),
    );

    const body = await response.json();
    expect(body.data).toEqual([
      {
        id: "member_123",
        organizationId: ORG_ID,
        role: "member",
        seatAssignedAt: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        user: {
          id: USER_ID,
          name: "Jane Doe",
          email: "jane@example.com",
          image: null,
        },
        lastSeenAt: "2025-06-08T14:30:00.000Z",
      },
    ]);
  });
});
