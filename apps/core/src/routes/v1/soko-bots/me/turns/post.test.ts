import { beforeEach, describe, expect, it, vi } from "vitest";
import { SokoBotReconciliationLeaseLostError } from "@/lib/soko-bot/reconciliation-lease";

const { pending, reconcileTurnMock, startTurnMock } = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  reconcileTurnMock: vi.fn(),
  startTurnMock: vi.fn(),
}));

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
      startTurn: startTurnMock,
      reconcileTurn: reconcileTurnMock,
    },
  };
});

import { errorHandler } from "@/helpers/error-handler";
import { coreEvlogMiddleware } from "@/lib/evlog";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  expectBackgroundProbe,
  probeBackgroundFailure,
} from "@/test/background-probe";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";
import mount from "./post";

const TURN_ID = "00000000-0000-4000-8000-000000000001";
const BOT_ID = "00000000-0000-4000-8000-000000000002";

function startTurn() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", coreEvlogMiddleware());
  app.use("*", async (c, next) => {
    c.set("authContext", {
      actor: "user",
      userId: "user-1",
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: "00000000-0000-4000-8000-0000000000aa",
      userId: "user-1",
      organizationId: null,
    });
    await next();
  });
  app.onError(errorHandler);
  mount(app);
  return app.request("/me/turns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientTurnId: "client-1",
      message: "Draft the board update",
    }),
  });
}

describe("POST /soko-bots/me/turns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pending.length = 0;
    startTurnMock.mockResolvedValue({
      turnId: TURN_ID,
      sokoBotId: BOT_ID,
      sessionId: "session-1",
      status: "STARTING",
      route: "DIRECT_RESPONSE",
      capabilities: [],
      duplicate: false,
      reconciliationLeaseToken: "lease-1",
    });
    reconcileTurnMock.mockResolvedValue(undefined);
  });

  it("reconciles the new turn as background work, off the request's event", async () => {
    // The real reconcile reaches `expireTurn`, whose `recordCoreWarning`
    // would otherwise find this request still live.
    expectBackgroundProbe("reconcileTurn");
    reconcileTurnMock.mockImplementationOnce(async () => {
      probeBackgroundFailure("reconcileTurn");
    });

    const response = await startTurn();
    await Promise.all(pending);

    expect(response.status).toBe(201);
    expect(reconcileTurnMock).toHaveBeenCalledWith(
      TURN_ID,
      undefined,
      "lease-1",
    );
  });

  it("logs a failed reconcile on its own event without the turn's text", async () => {
    const errors = expectCoreLog(
      "error",
      "Could not reconcile a new Soko Bot turn",
    );
    // A turn's error can quote what the member asked.
    reconcileTurnMock.mockRejectedValueOnce(
      new Error("Runtime refused: Draft the board update"),
    );

    const response = await startTurn();
    await Promise.all(pending);

    expect(response.status).toBe(201);
    expect(errors[0]?.why).toBe(
      "Reconciling the turn after the response failed",
    );
    expect(errors[0]?.cause).toBeUndefined();
    expect(errors[0]?.event).toMatchObject({
      operation: "soko_bot_turn_reconcile",
      turnId: TURN_ID,
      failure: { errorName: "Error" },
    });
    expect(errors[0]?.event.method).toBeUndefined();
    expect(JSON.stringify(errors[0]?.event)).not.toContain("board update");
  });

  it("records a replaced drain grant as info", async () => {
    reconcileTurnMock.mockRejectedValueOnce(
      new SokoBotReconciliationLeaseLostError(
        "Soko Bot reconciliation lease was replaced",
      ),
    );

    const response = await startTurn();
    await Promise.all(pending);

    expect(response.status).toBe(201);
    expect(coreLogEvents()).toContainEqual(
      expect.objectContaining({
        level: "info",
        operation: "soko_bot_turn_reconcile",
        turn: { id: TURN_ID },
        outcome: "lease_lost",
      }),
    );
  });
});
