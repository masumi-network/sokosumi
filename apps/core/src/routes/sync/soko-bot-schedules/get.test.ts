import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { coreEvlogMiddleware, tryUseLiveLogger } from "@/lib/evlog";
import { coreLogEvents, expectCoreLogWhys } from "@/test/core-log";

import mountSyncSokoBotSchedules from "./get";

const { pending, purge, reconcileTurn, run, syncDueSchedules } = vi.hoisted(
  () => ({
    pending: [] as Promise<unknown>[],
    /** The run the mocked handler starts, or none to run inside the request. */
    run: { syncRunId: undefined as string | undefined },
    purge: vi.fn(),
    reconcileTurn: vi.fn(),
    syncDueSchedules: vi.fn(),
  }),
);

vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn((work: Promise<unknown>) => {
    pending.push(work);
  }),
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: { reconcileTurn },
}));
vi.mock("@/services/soko-bot-schedule.service", () => ({
  purgeSokoBotSchedules: purge,
}));
vi.mock("@/services/soko-bot-schedules-sync.service", () => ({
  sokoBotSchedulesSyncService: { syncDueSchedules },
}));

// Run the operation under a fixed run id, as the handler does, so the route's
// events show they inherit it. With `run.syncRunId` unset it runs inside the
// request, without the handler's background wrap, so the route's
// reconciliation start has to keep itself off the request's event. The lock,
// auth and deadline belong to the handler's tests.
vi.mock("../handler.js", () => ({
  handleSyncRequest: async (
    c: { json: (body: unknown) => Response },
    _lockKey: string,
    operation: (
      context: import("../handler.js").SyncRunContext,
    ) => Promise<void>,
  ) => {
    const { createCoreLogger, runAsBackgroundWork } = await import(
      "@/lib/evlog"
    );
    const syncRun = async () => {
      const log = createCoreLogger({ operation: "cron_sync" });
      await operation({
        abortSignal: new AbortController().signal,
        deadlineMs: Date.now() + 60_000,
        msRemaining: () => 60_000,
        shouldContinue: () => true,
        log,
      });
      log.emit();
    };
    const { syncRunId } = run;
    await (syncRunId === undefined
      ? syncRun()
      : runAsBackgroundWork(syncRun, { syncRunId }));
    return c.json({ ok: true });
  },
}));

/** The run id the mocked handler starts each run under. */
const SYNC_RUN_ID = "01960001-0001-7001-8001-0000000000c1";

function createApp() {
  const app = new Hono<{ Variables: RequestIdVariables }>();
  app.use(requestId());
  app.use(coreEvlogMiddleware());
  const routes = new Hono();
  mountSyncSokoBotSchedules(routes);
  app.route("/", routes);
  return app;
}

/** The run's own event, sent when the run ends. */
function runEvent() {
  return coreLogEvents().find((event) => event.operation === "cron_sync");
}

beforeEach(() => {
  vi.resetAllMocks();
  pending.length = 0;
  run.syncRunId = SYNC_RUN_ID;
  syncDueSchedules.mockImplementation(
    async (input: {
      enqueueReconciliation: (turn: {
        turnId: string;
        leaseToken: string;
      }) => void;
    }) => {
      input.enqueueReconciliation({ turnId: "turn-1", leaseToken: "lease-1" });
      return { started: 1, skipped: 0 };
    },
  );
  reconcileTurn.mockResolvedValue(undefined);
  purge.mockResolvedValue({ spentOneTime: 2, failedRecurring: 0 });
});

describe("GET /soko-bot-schedules", () => {
  it("puts the sync's counts and what the purge removed on the run's event", async () => {
    await createApp().request("http://localhost/soko-bot-schedules");
    await Promise.all(pending);

    expect(runEvent()).toMatchObject({
      result: {
        started: 1,
        skipped: 0,
        purged: { spentOneTime: 2, failedRecurring: 0 },
      },
    });
  });

  it("starts the reconciliation as background work, off the request's event", async () => {
    // Inside the request: the route's own wrap must keep it off the event.
    run.syncRunId = undefined;
    let liveDuringReconciliation: unknown = "not called";
    reconcileTurn.mockImplementation(async () => {
      liveDuringReconciliation = tryUseLiveLogger();
    });

    await createApp().request("http://localhost/soko-bot-schedules");
    await Promise.all(pending);

    expect(reconcileTurn).toHaveBeenCalledWith(
      "turn-1",
      expect.any(AbortSignal),
      "lease-1",
    );
    expect(liveDuringReconciliation).toBeNull();
  });

  it("logs a failed reconciliation as its own error with the turn id and no error text", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "Could not reconcile a scheduled Soko Bot turn",
      ["Reconciling the turn right after its schedule started it failed"],
    );
    reconcileTurn.mockRejectedValue(
      new Error(
        "Prompt: draft a reply to alice@example.com, key sk_live_abc123",
      ),
    );

    await createApp().request("http://localhost/soko-bot-schedules");
    await Promise.all(pending);

    expect(errors[0]?.event).toMatchObject({
      operation: "soko_bot_schedule_reconciliation",
      syncRunId: SYNC_RUN_ID,
      turn: { id: "turn-1" },
      failure: { errorName: "Error" },
    });
    expect(errors[0]?.event.path).toBeUndefined();
    expect(errors[0]?.cause).toBeUndefined();
    const drained = JSON.stringify(coreLogEvents());
    expect(drained).not.toContain("draft a reply");
    expect(drained).not.toContain("alice@example.com");
    expect(drained).not.toContain("sk_live_abc123");
  });

  it("logs a failed purge as its own error with no error text, and still sends the run's event", async () => {
    const errors = expectCoreLogWhys(
      "error",
      "Could not purge spent Soko Bot schedules",
      ["The database delete of spent schedules failed"],
    );
    purge.mockRejectedValue(new Error("Schedule prompt: my private plan"));

    await createApp().request("http://localhost/soko-bot-schedules");
    await Promise.all(pending);

    expect(errors[0]?.event).toMatchObject({
      operation: "soko_bot_schedule_purge",
      syncRunId: SYNC_RUN_ID,
      failure: { errorName: "Error" },
    });
    expect(errors[0]?.cause).toBeUndefined();
    expect(JSON.stringify(coreLogEvents())).not.toContain("private plan");
    expect(runEvent()).toMatchObject({ result: { started: 1 } });
  });
});
