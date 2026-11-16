import { createRoute } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { evalTickSchema } from "@/schemas/eval.schema";
import { EVAL_TICK_LOCK_KEY } from "@/services/evals/eval-cron";
import {
  syncEvalLaneTurns,
  tickEvalRuns,
} from "@/services/evals/eval-runs.service";
import { syncLockService } from "@/services/sync-lock.service";

const tickRoute = createRoute({
  method: "post",
  path: "/tick",
  operationId: "tickAdminEvalRuns",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(
      evalTickSchema,
      "One step of the running eval run, for a Core without the minute cron",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(tickRoute, async (c) => {
    // The cron's lock: a tick here and the cron never move one lane twice.
    const lock = await syncLockService
      .acquireLock(EVAL_TICK_LOCK_KEY)
      .catch(() => null);
    if (!lock) return ok(c, { runId: null, completed: false, busy: true });
    try {
      const tick = await tickEvalRuns();
      // No cron reads the lanes' turns on here; a turn another tick is
      // already reading is left to it.
      if (tick.runId && !tick.completed)
        waitUntil(
          syncEvalLaneTurns(tick.runId).catch((error: unknown) => {
            console.warn("Eval lane turns could not be read on", {
              runId: tick.runId,
              error: error instanceof Error ? error.message : "unknown",
            });
          }),
        );
      return ok(c, { ...tick, busy: false });
    } finally {
      await syncLockService.releaseLock(lock.key, lock.ownerToken);
    }
  });
}
