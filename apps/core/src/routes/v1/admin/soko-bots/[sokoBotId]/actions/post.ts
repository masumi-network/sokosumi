import { createRoute } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { emitCoreError, runAsBackgroundWork } from "@/lib/evlog";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { reportSokoBotReconciliationLeaseLoss } from "@/lib/soko-bot/reconciliation-lease";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  adminSokoBotActionRequestSchema,
  adminSokoBotDetailSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { sokoBotUsageTotals } from "@/services/soko-bot-usage.service";
import {
  botParams,
  mapDetail,
  mapError,
  traceIdFromTraceparent,
} from "../../helpers.js";

const actionRoute = createRoute({
  method: "post",
  path: "/{sokoBotId}/actions",
  operationId: "performAdminSokoBotAction",
  tags: ["Admin"],
  request: {
    params: botParams,
    body: {
      content: {
        "application/json": { schema: adminSokoBotActionRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminSokoBotDetailSchema,
      "Updated Soko Bot diagnostics",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
    503: jsonErrorResponse("Preprod retry cannot resume now"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(actionRoute, async (c) => {
    const operator = requireAdminAuthContext(c.var.authContext);
    try {
      const action = c.req.valid("json");
      const { detail, reconciliation } =
        await sokoBotControlPlane.performAdminAction({
          sokoBotId: c.req.valid("param").sokoBotId,
          operatorId: operator.userId,
          ...action,
          requestId: c.var.requestId,
          traceId: traceIdFromTraceparent(c.req.header("traceparent")),
        });
      if (reconciliation) {
        const { turnId, leaseToken } = reconciliation;
        waitUntil(
          runAsBackgroundWork(() =>
            sokoBotControlPlane.reconcileTurn(turnId, undefined, leaseToken),
          ).catch((error) => {
            if (reportSokoBotReconciliationLeaseLoss(turnId, error)) return;
            // A turn's error can quote what the member asked: content-free
            // fields only.
            emitCoreError(
              {
                operation: "admin_soko_bot_retry_reconcile",
                turnId,
              },
              {
                message: "Could not reconcile an admin Soko Bot retry",
                why: "Reconciling the retried turn after the response failed",
                fix: "If the turn stays STARTING or RUNNING, look up the error name and code under failure.",
              },
              { failure: messageSafeErrorFields(error) },
            );
          }),
        );
      }
      // The same shape the detail route returns: `usage` is required, so
      // omitting it here failed response validation after the action had
      // already been performed.
      return ok(
        c,
        adminSokoBotDetailSchema.parse({
          ...mapDetail(detail),
          usage: await sokoBotUsageTotals(c.req.valid("param").sokoBotId),
        }),
      );
    } catch (error) {
      mapError(error);
    }
  });
}
