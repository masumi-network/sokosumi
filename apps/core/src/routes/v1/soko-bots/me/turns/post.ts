import { createRoute } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  startSokoBotTurnRequestSchema,
  startSokoBotTurnResponseSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { mapControlPlaneError } from "../../helpers.js";

const startTurnRoute = createRoute({
  method: "post",
  path: "/me/turns",
  operationId: "startMySokoBotTurn",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: startSokoBotTurnRequestSchema },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      startSokoBotTurnResponseSchema,
      "Soko Bot turn accepted",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(startTurnRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      const result = await sokoBotControlPlane.startTurn({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        ...c.req.valid("json"),
      });
      if (
        result.reconciliationLeaseToken &&
        (result.status === "STARTING" || result.status === "RUNNING")
      ) {
        waitUntil(
          sokoBotControlPlane
            .reconcileTurn(
              result.turnId,
              undefined,
              result.reconciliationLeaseToken,
            )
            .catch((error) => {
              console.error("Soko Bot turn reconciliation failed", {
                turnId: result.turnId,
                error: error instanceof Error ? error.message : "unknown",
              });
            }),
        );
      }
      return created(c, startSokoBotTurnResponseSchema.parse(result));
    } catch (error) {
      mapControlPlaneError(error);
    }
  });
}
