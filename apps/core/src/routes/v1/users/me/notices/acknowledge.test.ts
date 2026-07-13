import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountPostNoticeAcknowledge from "../../[id]/notices/[noticeId]/acknowledge/post";

const { prismaTransactionMock, userFindUniqueMock } = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

const USER_ID = "user_123";
const NOTICE_ID = "notice_123";
const EXISTING_ACKNOWLEDGED_AT = new Date("2026-02-20T08:00:00.000Z");
const CREATED_ACKNOWLEDGED_AT = new Date("2026-02-20T09:05:00.000Z");

interface NoticeRecord {
  id: string;
  kind: "LEGAL_TERMS" | "ANNOUNCEMENT";
  bodyMarkdown: string;
  effectiveAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface TransactionMock {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  notice: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  noticeAcknowledgment: {
    findUnique: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
}

function createNotice(overrides: Partial<NoticeRecord> = {}): NoticeRecord {
  return {
    id: NOTICE_ID,
    kind: "LEGAL_TERMS",
    bodyMarkdown: "# Notice",
    effectiveAt: new Date("2026-01-10T00:00:00.000Z"),
    isActive: true,
    createdAt: new Date("2026-01-09T00:00:00.000Z"),
    updatedAt: new Date("2026-01-09T00:00:00.000Z"),
    ...overrides,
  };
}

function createApp(actor: "user" | "coworker" = "user") {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    if (actor === "coworker") {
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: TEST_VENDOR_ID,
      });
    } else {
      c.set("authContext", {
        actor: "user",
        userId: USER_ID,
        organizationId: null,
        role: "user",
      });
    }

    return await next();
  });

  const userByIdApp = new OpenAPIHono<{
    Variables: AuthVariables & UserRouteVariables;
  }>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountPostNoticeAcknowledge(
    userByIdApp as unknown as OpenAPIHonoWithAuth<UserRouteVariables>,
  );
  app.route("/:id", userByIdApp);

  return app;
}

function mockTransaction(transaction: TransactionMock) {
  prismaTransactionMock.mockImplementation(async (callback) => {
    return await callback(transaction);
  });
}

describe("POST /notices/{id}/acknowledge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(CREATED_ACKNOWLEDGED_AT);
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: USER_ID });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates acknowledgment on first request", async () => {
    const tx: TransactionMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      },
      notice: {
        findFirst: vi.fn().mockResolvedValue({ id: NOTICE_ID }),
        findUnique: vi.fn(),
      },
      noticeAcknowledgment: {
        findUnique: vi.fn().mockResolvedValue(null),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request(
      `http://localhost/me/notices/${NOTICE_ID}/acknowledge`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: { id: true },
    });
    expect(tx.noticeAcknowledgment.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: USER_ID,
          noticeId: NOTICE_ID,
          acknowledgedAt: CREATED_ACKNOWLEDGED_AT,
        },
      ],
      skipDuplicates: true,
    });

    const body = await response.json();
    expect(body.data).toEqual({
      noticeId: NOTICE_ID,
      acknowledgedAt: CREATED_ACKNOWLEDGED_AT.toISOString(),
      alreadyAcknowledged: false,
    });
  });

  it("returns existing acknowledgment on repeated request", async () => {
    const tx: TransactionMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      },
      notice: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      noticeAcknowledgment: {
        findUnique: vi.fn().mockResolvedValue({
          acknowledgedAt: EXISTING_ACKNOWLEDGED_AT,
        }),
        createMany: vi.fn(),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request(
      `http://localhost/me/notices/${NOTICE_ID}/acknowledge`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(tx.notice.findFirst).not.toHaveBeenCalled();
    expect(tx.noticeAcknowledgment.createMany).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body.data).toEqual({
      noticeId: NOTICE_ID,
      acknowledgedAt: EXISTING_ACKNOWLEDGED_AT.toISOString(),
      alreadyAcknowledged: true,
    });
  });

  it("returns existing acknowledgment when create is skipped due to race", async () => {
    const tx: TransactionMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      },
      notice: {
        findFirst: vi.fn().mockResolvedValue({ id: NOTICE_ID }),
        findUnique: vi.fn(),
      },
      noticeAcknowledgment: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
          acknowledgedAt: EXISTING_ACKNOWLEDGED_AT,
        }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request(
      `http://localhost/me/notices/${NOTICE_ID}/acknowledge`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(200);
    expect(tx.noticeAcknowledgment.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: USER_ID,
          noticeId: NOTICE_ID,
          acknowledgedAt: CREATED_ACKNOWLEDGED_AT,
        },
      ],
      skipDuplicates: true,
    });

    const body = await response.json();
    expect(body.data).toEqual({
      noticeId: NOTICE_ID,
      acknowledgedAt: EXISTING_ACKNOWLEDGED_AT.toISOString(),
      alreadyAcknowledged: true,
    });
  });

  it("returns 404 when notice does not exist", async () => {
    const tx: TransactionMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      },
      notice: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      noticeAcknowledgment: {
        findUnique: vi.fn().mockResolvedValue(null),
        createMany: vi.fn(),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request(
      `http://localhost/me/notices/${NOTICE_ID}/acknowledge`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(404);
    expect(tx.noticeAcknowledgment.createMany).not.toHaveBeenCalled();
  });

  it("returns 409 when notice is ineligible", async () => {
    const tx: TransactionMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      },
      notice: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(createNotice()),
      },
      noticeAcknowledgment: {
        findUnique: vi.fn().mockResolvedValue(null),
        createMany: vi.fn(),
      },
    };
    mockTransaction(tx);

    const app = createApp();
    const response = await app.request(
      `http://localhost/me/notices/${NOTICE_ID}/acknowledge`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(409);
    expect(tx.noticeAcknowledgment.createMany).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker-authenticated requests", async () => {
    const app = createApp("coworker");
    const response = await app.request(
      `http://localhost/me/notices/${NOTICE_ID}/acknowledge`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });
});
