import { createRoute } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import {
  ComposioApiError,
  ComposioConfigError,
} from "@/clients/composio.client";
import { badRequest, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { OpenAPIHonoWithAuth, withGlobalHeaderParameters } from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import {
  completeComposioCallbackRequestSchema,
  completeComposioCallbackResponseSchema,
} from "@/schemas/composio.schema";
import { completeComposioCallback } from "@/services/composio-callback-completion.service";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/callback/complete",
    description:
      "Redeem the current user's one-use Composio OAuth callback session.",
    tags: ["Composio"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: completeComposioCallbackRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        completeComposioCallbackResponseSchema,
        "Composio callback verified",
      ),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

const app = new OpenAPIHonoWithAuth();

export function mountComposioCallback(
  app: Pick<OpenAPIHonoWithAuth, "openapi">,
): void {
  app.openapi(route, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const { connectionId, sessionUri } = c.req.valid("json");

    try {
      await completeComposioCallback({
        connectionId,
        sessionUri,
        userId: userContext.userId,
      });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      if (error instanceof ComposioConfigError) {
        throw serviceUnavailable(
          "Integrations are not configured on this server.",
        );
      }
      if (error instanceof ComposioApiError) {
        if (
          error.httpStatus >= 500 ||
          error.httpStatus === 401 ||
          error.httpStatus === 403 ||
          error.httpStatus === 429
        ) {
          throw serviceUnavailable("Integrations are temporarily unavailable.");
        }
        throw badRequest("Unable to verify the OAuth callback.");
      }
      throw error;
    }

    return ok(c, completeComposioCallbackResponseSchema.parse({ ok: true }));
  });
}

mountComposioCallback(app);

export default app;
