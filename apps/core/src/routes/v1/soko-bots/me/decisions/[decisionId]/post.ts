import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  resolveSokoBotDecisionRequestSchema,
  sokoBotPendingDecisionSchema,
} from "@/schemas/soko-bot.schema";
import { sokoBotRuntimeService } from "@/services/soko-bot-runtime.service";
import { decisionParams, mapControlPlaneError } from "../../../helpers.js";

const resolveDecisionRoute = createRoute({
  method: "post",
  path: "/me/decisions/{decisionId}",
  operationId: "resolveMySokoBotDecision",
  tags: ["Soko Bots"],
  request: {
    params: decisionParams,
    body: {
      content: {
        "application/json": { schema: resolveSokoBotDecisionRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      sokoBotPendingDecisionSchema,
      "Resolve Soko Bot decision",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(resolveDecisionRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    try {
      const decision = await sokoBotRuntimeService.resolveDecision(
        auth.userId,
        c.req.valid("param").decisionId,
        c.req.valid("json").resolution === "ACCEPT",
      );
      return ok(c, sokoBotPendingDecisionSchema.parse(decision));
    } catch (error) {
      mapControlPlaneError(error);
    }
  });
}
