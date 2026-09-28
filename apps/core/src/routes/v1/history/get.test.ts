import { beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "@/config/constants";
import type { TransactionHistoryRow } from "@/helpers/transaction-history";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetHistory from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { agentFindManyMock, prismaQueryRawMock, userFindManyMock } = vi.hoisted(
  () => ({
    agentFindManyMock: vi.fn(),
    prismaQueryRawMock: vi.fn(),
    userFindManyMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: prismaQueryRawMock,
    agent: { findMany: agentFindManyMock },
    user: { findMany: userFindManyMock },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const WORKSPACE_CONTEXT = {
  workspaceId: "11111111-1111-7111-8111-111111111111",
  userId: null,
  organizationId: "org_123",
} satisfies WorkspaceVariables["workspaceContext"];

/** 10^10 ledger units are one credit. Spends are negative. */
const CREDIT = 10_000_000_000n;

function createApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
  workspaceContext: WorkspaceVariables["workspaceContext"] = WORKSPACE_CONTEXT,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);
    return await next();
  });

  mountGetHistory(app);
  return app;
}

function createLedgerRow(
  overrides: Partial<TransactionHistoryRow> = {},
): TransactionHistoryRow {
  return {
    id: "tx_123",
    consumedAt: new Date("2026-04-02T10:00:00.000Z"),
    amount: -25n * CREDIT,
    kind: "unattributed",
    userId: "user_123",
    projectId: null,
    jobId: null,
    jobName: null,
    agentId: null,
    imageJobId: null,
    imageModel: null,
    imagePrompt: null,
    taskId: null,
    taskName: null,
    taskEventId: null,
    taskEventComment: null,
    coworkerId: null,
    coworkerName: null,
    sokoBotId: null,
    bucketSource: null,
    ...overrides,
  };
}

/** The route runs the page query first, then the count query. */
function mockLedger(rows: TransactionHistoryRow[], count = rows.length) {
  prismaQueryRawMock.mockReset();
  prismaQueryRawMock
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce([{ count: BigInt(count) }]);
}

describe("GET /history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLedger([]);
    agentFindManyMock.mockResolvedValue([]);
    userFindManyMock.mockResolvedValue([]);
  });

  it("returns credits as a positive number and the consumption date", async () => {
    mockLedger([createLedgerRow({ amount: -25n * CREDIT })]);

    const response = await createApp().request("http://localhost/");
    const body = (await response.json()) as {
      data: Array<{ credits: number; consumedAt: string; kind: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      kind: "unattributed",
      credits: 25,
      consumedAt: "2026-04-02T10:00:00.000Z",
    });
  });

  it("names an unattributed row's credit bucket when one is known", async () => {
    mockLedger([
      createLedgerRow({ bucketSource: "STRIPE_SUBSCRIPTION_PERIOD" }),
    ]);

    const response = await createApp().request("http://localhost/");
    const body = (await response.json()) as {
      data: Array<{ bucketSource: string | null; title: string }>;
    };

    expect(body.data[0]).toMatchObject({
      bucketSource: "STRIPE_SUBSCRIPTION_PERIOD",
      title: "Credit consumption",
    });
  });

  it("leaves an unattributed row's source null rather than inventing one", async () => {
    mockLedger([createLedgerRow({ bucketSource: null })]);

    const response = await createApp().request("http://localhost/");
    const body = (await response.json()) as {
      data: Array<{ bucketSource: string | null; description: string | null }>;
    };

    expect(body.data[0]?.bucketSource).toBeNull();
    expect(body.data[0]?.description).toBeNull();
  });

  it("resolves the agent behind a job consumption", async () => {
    agentFindManyMock.mockResolvedValue([
      {
        id: "agent_123",
        name: "Research Agent",
        icon: "https://example.com/research.svg",
        metadataOverride: null,
      },
    ]);
    mockLedger([
      createLedgerRow({
        kind: "job",
        jobId: "job_123",
        jobName: "Research competitors",
        agentId: "agent_123",
      }),
    ]);

    const response = await createApp().request("http://localhost/");
    const body = (await response.json()) as {
      data: Array<{
        agentIcon: string | null;
        agentName: string | null;
        jobId: string;
        title: string;
      }>;
    };

    expect(body.data[0]).toMatchObject({
      jobId: "job_123",
      title: "Research competitors",
      agentName: "Research Agent",
      agentIcon: "https://example.com/research.svg",
    });
  });

  it("labels a task consumption with its task and charging event", async () => {
    mockLedger([
      createLedgerRow({
        kind: "task",
        taskId: "tsk_123",
        taskName: "Summarise the report",
        taskEventId: "evt_123",
        taskEventComment: "Agent run",
      }),
    ]);

    const response = await createApp().request("http://localhost/");
    const body = (await response.json()) as {
      data: Array<{
        description: string | null;
        taskEventId: string;
        taskId: string;
        title: string;
      }>;
    };

    expect(body.data[0]).toMatchObject({
      kind: "task",
      taskId: "tsk_123",
      taskEventId: "evt_123",
      title: "Summarise the report",
      description: "Agent run",
    });
  });

  it("returns the transaction id as the next cursor when more remain", async () => {
    const rows = Array.from(
      { length: LIMITS.DEFAULT_PAGINATION_LIMIT + 1 },
      (_, index) => createLedgerRow({ id: `tx_${index}` }),
    );
    mockLedger(rows, 100);

    const response = await createApp().request("http://localhost/");
    const body = (await response.json()) as {
      data: unknown[];
      meta: { pagination: { nextCursor: string | null; total: number } };
    };

    expect(body.data).toHaveLength(LIMITS.DEFAULT_PAGINATION_LIMIT);
    expect(body.meta.pagination.nextCursor).toBe(
      `tx_${LIMITS.DEFAULT_PAGINATION_LIMIT - 1}`,
    );
    expect(body.meta.pagination.total).toBe(100);
  });

  it("rejects an unknown source kind", async () => {
    const response = await createApp().request(
      "http://localhost/?types=conversation",
    );

    expect(response.status).toBe(422);
    expect(prismaQueryRawMock).not.toHaveBeenCalled();
  });

  it("accepts every supported source kind", async () => {
    const response = await createApp().request(
      "http://localhost/?types=job,image,task,coworker,sokoBot,unattributed",
    );

    expect(response.status).toBe(200);
  });

  it("rejects a projectId that is neither a UUID nor the literal null", async () => {
    const response = await createApp().request(
      "http://localhost/?projectId=not-a-uuid",
    );

    expect(response.status).toBe(422);
    expect(prismaQueryRawMock).not.toHaveBeenCalled();
  });
});
