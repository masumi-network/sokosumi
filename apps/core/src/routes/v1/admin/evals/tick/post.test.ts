import { beforeEach, describe, expect, it, vi } from "vitest";

const { acquireLockMock, pending, syncLaneTurnsMock, tickMock } = vi.hoisted(
  () => ({
    acquireLockMock: vi.fn(),
    pending: [] as Promise<unknown>[],
    syncLaneTurnsMock: vi.fn(),
    tickMock: vi.fn(),
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
vi.mock("@/services/evals/eval-runs.service", () => ({
  syncEvalLaneTurns: syncLaneTurnsMock,
  tickEvalRuns: tickMock,
}));
vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: {
    acquireLock: acquireLockMock,
    releaseLock: vi.fn(async () => true),
  },
}));

import { coreEvlogMiddleware } from "@/lib/evlog";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  expectBackgroundProbe,
  probeBackgroundFailure,
} from "@/test/background-probe";
import { expectCoreLog } from "@/test/core-log";
import mount from "./post";

const RUN_ID = "00000000-0000-4000-8000-000000000004";

function tick() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", coreEvlogMiddleware());
  mount(app);
  return app.request("/tick", { method: "POST" });
}

describe("POST /admin/evals/tick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pending.length = 0;
    acquireLockMock.mockResolvedValue({ key: "eval-tick", ownerToken: "t" });
    tickMock.mockResolvedValue({ runId: RUN_ID, completed: false });
    syncLaneTurnsMock.mockResolvedValue(undefined);
  });

  it("reads on the lanes' turns as background work, off the request's event", async () => {
    expectBackgroundProbe("syncEvalLaneTurns");
    syncLaneTurnsMock.mockImplementationOnce(async () => {
      probeBackgroundFailure("syncEvalLaneTurns");
    });

    const response = await tick();
    await Promise.all(pending);

    expect(response.status).toBe(200);
    expect(syncLaneTurnsMock).toHaveBeenCalledWith(RUN_ID);
  });

  it("warns on its own event, without the turns' text, when the lanes cannot be read", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Could not read on an eval run's lane turns",
    );
    // Lane turns carry the eval's prompts and answers.
    syncLaneTurnsMock.mockRejectedValueOnce(
      new Error("Turn failed: summarize the Q4 plan"),
    );

    const response = await tick();
    await Promise.all(pending);

    expect(response.status).toBe(200);
    expect(warnings[0]?.why).toBe(
      "Syncing the lanes' Soko Bot turns failed after the tick",
    );
    expect(warnings[0]?.cause).toBeUndefined();
    expect(warnings[0]?.event).toMatchObject({
      operation: "admin_eval_tick",
      runId: RUN_ID,
      failure: { errorName: "Error" },
    });
    expect(warnings[0]?.event.method).toBeUndefined();
    expect(JSON.stringify(warnings[0]?.event)).not.toContain("Q4 plan");
  });
});
