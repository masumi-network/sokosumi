import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

/** A tester continues a Cuso without a CMO subscription (ADR 0068). */

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

/** 10^10 ledger units are one credit. */
const CREDIT = 10_000_000_000n;
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";

const m = vi.hoisted(() => ({
  allowlist: [] as string[],
  /** The Project's Tester credit buckets, as the database holds them. */
  buckets: [] as { amount: bigint; consumptions: { amount: bigint }[] }[],
  grantFreeCredits: vi.fn(),
  member: true,
  prisma: {
    $transaction: vi.fn(),
    creditBucket: { findMany: vi.fn() },
    polarSubscription: { findFirst: vi.fn() },
    sokoBot: { findFirst: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    workspace: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db/prisma", () => ({ default: m.prisma }));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      CMO_SUBSCRIPTION_SKIP_ALLOWLIST: m.allowlist,
    }),
  };
});
vi.mock("@/lib/image-studio/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/image-studio/access")>()),
  requireProjectAccessForUser: async () => {
    const { notFound } = await import("@/helpers/error");
    if (!m.member) throw notFound("Project not found");
    return { workspaceId: "ws-1", organizationId: "org-1" };
  },
}));
vi.mock("@/services/free-credit-admin.service", () => ({
  freeCreditAdminService: { grantFreeCredits: m.grantFreeCredits },
}));
vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

let app: OpenAPIHonoWithAuth;
beforeAll(async () => {
  const { default: mount } = await import("./post");
  app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user-1",
      organizationId: null,
      role: "user",
      authenticationMethod: "oauth",
      oauthClientId: "cmo-oauth-client",
    });
    return await next();
  });
  mount(app);
  app.onError(errorHandler);
});

function skip() {
  return app.request(`/projects/${PROJECT_ID}/skip-subscription`, {
    method: "POST",
  });
}

/** Spends what the Project's Tester credits hold. */
function spendAll() {
  for (const bucket of m.buckets) {
    bucket.consumptions.push({ amount: bucket.amount });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  m.allowlist = ["@qa.io"];
  m.buckets = [];
  m.member = true;
  m.prisma.user.findUnique.mockResolvedValue({ email: "Tester@QA.io" });
  m.prisma.workspace.findUnique.mockResolvedValue({ organizationId: "org-1" });
  m.prisma.sokoBot.findFirst.mockResolvedValue({
    id: "bot-1",
    createdAt: new Date("2026-11-01T09:00:00.000Z"),
    project: {
      id: PROJECT_ID,
      workspaceId: "ws-1",
      websiteUrl: "https://acme.io",
      workspace: { organizationId: "org-1" },
      brandBrain: null,
    },
  });
  // The Cuso's row, write-locked by the grant: live.
  m.prisma.sokoBot.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.polarSubscription.findFirst.mockResolvedValue(null);
  m.prisma.creditBucket.findMany.mockImplementation(async () => m.buckets);
  // The write lock on Cuso's row makes two grants take turns.
  let queue: Promise<unknown> = Promise.resolve();
  m.prisma.$transaction.mockImplementation((run) => {
    const turn = queue.then(() => run(m.prisma));
    queue = turn.catch(() => {});
    return turn;
  });
  m.grantFreeCredits.mockImplementation(async ({ credits }) => {
    m.buckets.push({ amount: BigInt(credits) * CREDIT, consumptions: [] });
    return { bucketId: `bucket-${m.buckets.length}` };
  });
});

describe("POST /v1/cmo/projects/{projectId}/skip-subscription", () => {
  it("gives a tester's Cuso 10,000 Tester credits", async () => {
    const response = await skip();

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ skipped: true });
    expect(m.grantFreeCredits).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        target: { targetType: "organization", targetId: "org-1" },
        projectId: PROJECT_ID,
        credits: 10_000,
        ttlDays: null,
        referenceType: "CMO_TESTER_CREDITS",
      }),
    );
  });

  it("grants once on a double click", async () => {
    const responses = await Promise.all([skip(), skip()]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(m.grantFreeCredits).toHaveBeenCalledTimes(1);
  });

  it("refuses a person who is not on the skip allowlist", async () => {
    m.allowlist = ["@acme.io"];

    const response = await skip();

    expect(response.status).toBe(403);
    expect(m.grantFreeCredits).not.toHaveBeenCalled();
  });

  it("refuses everyone while the allowlist is empty", async () => {
    m.allowlist = [];

    expect((await skip()).status).toBe(403);
    expect(m.grantFreeCredits).not.toHaveBeenCalled();
  });

  it("answers 404 to a person who is not a member", async () => {
    m.member = false;

    expect((await skip()).status).toBe(404);
    expect(m.grantFreeCredits).not.toHaveBeenCalled();
  });

  it("refuses a Cuso with an active subscription", async () => {
    m.prisma.polarSubscription.findFirst.mockResolvedValue({ id: "sub-1" });

    expect((await skip()).status).toBe(409);
    expect(m.grantFreeCredits).not.toHaveBeenCalled();
  });

  it("refuses while his Tester credits are not used up", async () => {
    m.buckets = [{ amount: 10_000n * CREDIT, consumptions: [] }];

    expect((await skip()).status).toBe(409);
    expect(m.grantFreeCredits).not.toHaveBeenCalled();
  });

  it("grants again once they are used up", async () => {
    expect((await skip()).status).toBe(200);
    spendAll();

    expect((await skip()).status).toBe(200);
    expect(m.grantFreeCredits).toHaveBeenCalledTimes(2);
  });

  it("grants nothing to a Cuso who ended meanwhile", async () => {
    m.prisma.sokoBot.updateMany.mockResolvedValue({ count: 0 });

    expect((await skip()).status).toBe(404);
    expect(m.grantFreeCredits).not.toHaveBeenCalled();
  });
});
