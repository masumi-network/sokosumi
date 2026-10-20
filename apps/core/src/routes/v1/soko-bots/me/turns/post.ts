import { createRoute, type z } from "@hono/zod-openapi";
import { waitUntil } from "@vercel/functions";
import type { Context } from "hono";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  startSokoBotTurnRequestSchema,
  startSokoBotTurnResponseSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { sokoBotIdParams } from "../../bot-selector.js";
import { mapControlPlaneError } from "../../helpers.js";

const body = {
  content: { "application/json": { schema: startSokoBotTurnRequestSchema } },
};

const spec = {
  method: "post" as const,
  tags: ["Soko Bots"],
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
};

const startTurnRoute = createRoute({
  ...spec,
  path: "/me/turns",
  operationId: "startMySokoBotTurn",
  request: { body },
});

const startTurnByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/turns",
  operationId: "startSokoBotTurn",
  description:
    "Asks the bot as the caller. On a shared bot the caller is the asking member and their seat pays.",
  request: { body, params: sokoBotIdParams },
});

async function handle(
  c: Context<EnvVariables>,
  request: z.infer<typeof startSokoBotTurnRequestSchema>,
  sokoBotId?: string,
) {
  const auth = requireUserAuthContext(c.var.authContext);
  const workspace = requireWorkspaceContext(c.var.workspaceContext);
  try {
    const result = await sokoBotControlPlane.startTurn({
      userId: auth.userId,
      workspaceId: workspace.workspaceId,
      ...(sokoBotId ? { sokoBotId } : {}),
      ...request,
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
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(startTurnRoute, (c) => handle(c, c.req.valid("json")));
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(startTurnByIdRoute, (c) =>
    handle(c, c.req.valid("json"), c.req.valid("param").sokoBotId),
  );
}
