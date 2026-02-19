import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostNoticeAcknowledge from "./[id]/acknowledge/post";

const { prismaTransactionMock } = vi.hoisted(() => ({
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
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

function createApp(coworkerId: string | null = null) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      userId: USER_ID,
      organizationId: null,
      coworkerId,
    });

    return await next();
  });

  mountPostNoticeAcknowledge(app as unknown as OpenAPIHonoWithAuth);

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
      `http://localhost/notices/${NOTICE_ID}/acknowledge`,
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
      `http://localhost/notices/${NOTICE_ID}/acknowledge`,
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
      `http://localhost/notices/${NOTICE_ID}/acknowledge`,
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
      `http://localhost/notices/${NOTICE_ID}/acknowledge`,
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
      `http://localhost/notices/${NOTICE_ID}/acknowledge`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(409);
    expect(tx.noticeAcknowledgment.createMany).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker-authenticated requests", async () => {
    const app = createApp("cow_123");
    const response = await app.request(
      `http://localhost/notices/${NOTICE_ID}/acknowledge`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });
});
