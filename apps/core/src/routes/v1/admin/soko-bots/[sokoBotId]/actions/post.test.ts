import { beforeEach, describe, expect, it, vi } from "vitest";

const { pending, performAdminActionMock, reconcileTurnMock } = vi.hoisted(
  () => ({
    pending: [] as Promise<unknown>[],
    performAdminActionMock: vi.fn(),
    reconcileTurnMock: vi.fn(),
  }),
);

vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: (work: Promise<unknown>) => pending.push(work),
}));
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
vi.mock("@/services/soko-bot-control-plane.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/soko-bot-control-plane.service")
    >();
  return {
    ...actual,
    sokoBotControlPlane: {
      performAdminAction: performAdminActionMock,
      reconcileTurn: reconcileTurnMock,
    },
  };
});
vi.mock("@/services/soko-bot-usage.service", () => ({
  sokoBotUsageTotals: vi.fn(async () => ({})),
}));
// The detail's shape is the detail route's business; this file checks the
// retry's background reconcile.
vi.mock("../../helpers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../helpers.js")>()),
  mapDetail: (detail: unknown) => detail,
}));
vi.mock("@/schemas/soko-bot.schema", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/schemas/soko-bot.schema")>();
  const { z } = await import("@hono/zod-openapi");
  return { ...actual, adminSokoBotDetailSchema: z.unknown() };
});

import { errorHandler } from "@/helpers/error-handler";
import { coreEvlogMiddleware } from "@/lib/evlog";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  expectBackgroundProbe,
  probeBackgroundFailure,
} from "@/test/background-probe";
import { expectCoreLog } from "@/test/core-log";
import mount from "./post";

const BOT_ID = "00000000-0000-4000-8000-000000000002";
const RETRY_TURN_ID = "00000000-0000-4000-8000-000000000003";

function retryLastFailed() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", coreEvlogMiddleware());
  app.use("*", async (c, next) => {
    c.set("authContext", {
      actor: "user",
      userId: "admin-1",
      organizationId: null,
      role: "admin",
    });
    c.set("requestId", "admin-action");
    await next();
  });
  app.onError(errorHandler);
  mount(app);
  return app.request(`/${BOT_ID}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operationId: "op-1",
      action: "RETRY_LAST_FAILED",
      reason: "Customer asked for a retry",
    }),
  });
}

const detail = {
  schedules: [],
  turns: [
    {
      id: RETRY_TURN_ID,
      source: "ADMIN_RETRY",
      status: "RUNNING",
      leaseToken: "row-lease",
    },
  ],
};

describe("POST /admin/soko-bots/{sokoBotId}/actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pending.length = 0;
    performAdminActionMock.mockResolvedValue({
      detail,
      reconciliation: { turnId: RETRY_TURN_ID, leaseToken: "lease-1" },
    });
    reconcileTurnMock.mockResolvedValue(undefined);
  });

  it("reconciles the retried turn as background work, off the request's event", async () => {
    // The real reconcile reaches `expireTurn`, whose `recordCoreWarning`
    // would otherwise find this request still live.
    expectBackgroundProbe("reconcileTurn");
    reconcileTurnMock.mockImplementationOnce(async () => {
      probeBackgroundFailure("reconcileTurn");
    });

    const response = await retryLastFailed();
    await Promise.all(pending);

    expect(response.status).toBe(200);
    expect(reconcileTurnMock).toHaveBeenCalledWith(
      RETRY_TURN_ID,
      undefined,
      "lease-1",
    );
  });

  it("returns diagnostics on replay without borrowing the retry row's lease", async () => {
    performAdminActionMock.mockResolvedValueOnce({ detail });

    const response = await retryLastFailed();
    await Promise.all(pending);

    expect(response.status).toBe(200);
    expect(reconcileTurnMock).not.toHaveBeenCalled();
  });

  it("logs a failed reconcile on its own event without the turn's text", async () => {
    const errors = expectCoreLog(
      "error",
      "Could not reconcile an admin Soko Bot retry",
    );
    // A turn's error can quote what the member asked.
    reconcileTurnMock.mockRejectedValueOnce(
      new Error("Runtime refused: Draft the board update"),
    );

    const response = await retryLastFailed();
    await Promise.all(pending);

    expect(response.status).toBe(200);
    expect(errors[0]?.why).toBe(
      "Reconciling the retried turn after the response failed",
    );
    expect(errors[0]?.cause).toBeUndefined();
    expect(errors[0]?.event).toMatchObject({
      operation: "admin_soko_bot_retry_reconcile",
      turnId: RETRY_TURN_ID,
      failure: { errorName: "Error" },
    });
    expect(errors[0]?.event.method).toBeUndefined();
    expect(JSON.stringify(errors[0]?.event)).not.toContain("board update");
  });
});
