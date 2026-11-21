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

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

const {
  organizationFindUniqueMock,
  memberFindUniqueMock,
  memberFindManyMock,
  transactionGroupByMock,
  userFindManyMock,
} = vi.hoisted(() => ({
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  transactionGroupByMock: vi.fn(),
  userFindManyMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  const { mockRequireOwnerUserContext } = await import(
    "@/test-fixtures/require-owner-user-context.mock.js"
  );
  return {
    ...actual,
    authMiddleware: stubAuthMiddleware,
    requireOwnerUserContext: mockRequireOwnerUserContext,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: { findUnique: organizationFindUniqueMock },
    member: {
      findUnique: memberFindUniqueMock,
      findMany: memberFindManyMock,
    },
    transaction: { groupBy: transactionGroupByMock },
    user: { findMany: userFindManyMock },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_admin",
  organizationId: null,
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
};

const CREDIT = 10_000_000_000n;

let mountGetOrganizationCreditSpend: (app: OpenAPIHonoWithAuth) => void;

function getCreditSpend(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
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
  mountGetOrganizationCreditSpend(app);
  return app.request("http://localhost/org_123/credit-spend");
}

function setRole(role: string | null) {
  organizationFindUniqueMock.mockResolvedValue({ id: "org_123" });
  memberFindUniqueMock.mockResolvedValue(role ? { role } : null);
}

beforeAll(async () => {
  mountGetOrganizationCreditSpend = (await import("./get")).default;
});

describe("GET /organizations/{id}/credit-spend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses a plain member", async () => {
    setRole("member");
    const response = await getCreditSpend();
    expect(response.status).toBe(403);
    expect(transactionGroupByMock).not.toHaveBeenCalled();
  });

  it("refuses a non-member", async () => {
    setRole(null);
    expect((await getCreditSpend()).status).toBe(403);
  });

  it("refuses coworker authentication", async () => {
    expect((await getCreditSpend(COWORKER_AUTH_CONTEXT)).status).toBe(403);
  });

  it("sums spend per billed user for this and last UTC month", async () => {
    setRole("admin");
    memberFindManyMock.mockResolvedValue([
      { userId: "user_admin" },
      { userId: "user_idle" },
    ]);
    transactionGroupByMock.mockImplementation(
      (args: { where: { createdAt: { lt?: Date } } }) =>
        Promise.resolve(
          args.where.createdAt.lt
            ? [{ userId: "user_admin", _sum: { amount: -3n * CREDIT } }]
            : [
                { userId: "user_admin", _sum: { amount: -5n * CREDIT } },
                { userId: "user_gone", _sum: { amount: -8n * CREDIT } },
                { userId: null, _sum: { amount: -CREDIT / 2n } },
              ],
        ),
    );
    userFindManyMock.mockResolvedValue([
      { id: "user_admin", name: "Ada", image: null },
      { id: "user_idle", name: "Ida", image: null },
      { id: "user_gone", name: "Gus", image: "https://img" },
    ]);

    const response = await getCreditSpend();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(transactionGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org_123",
          amount: { lt: 0n },
          createdAt: { gte: new Date("2026-01-01T00:00:00Z") },
        },
      }),
    );
    expect(transactionGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date("2025-12-01T00:00:00Z"),
            lt: new Date("2026-01-01T00:00:00Z"),
          },
        }),
      }),
    );
    expect(body.data).toEqual({
      month: "2026-01",
      previousMonth: "2025-12",
      rows: [
        {
          userId: "user_gone",
          name: "Gus",
          image: "https://img",
          isMember: false,
          credits: 8,
          previousCredits: 0,
        },
        {
          userId: "user_admin",
          name: "Ada",
          image: null,
          isMember: true,
          credits: 5,
          previousCredits: 3,
        },
        {
          userId: null,
          name: null,
          image: null,
          isMember: false,
          credits: 0.5,
          previousCredits: 0,
        },
        {
          userId: "user_idle",
          name: "Ida",
          image: null,
          isMember: true,
          credits: 0,
          previousCredits: 0,
        },
      ],
    });
  });
});
