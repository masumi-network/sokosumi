import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { getCredits } from "@/helpers/user";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { creditsResponseSchema } from "@/schemas/user.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/credits",
    description: "Get current user's or organization's credit balance",
    tags: ["Users"],
    responses: {
      200: jsonSuccessResponse(
        creditsResponseSchema,
        "Retrieve the current user's or organization's credits",
        {
          data: {
            credits: 100.0,
          },
          meta: {
            timestamp: "2025-01-01T00:00:00.000Z",
            requestId: "550e8400-e29b-41d4-a716-446655440000",
          },
        },
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);

    const credits = await getCredits(
      authContext.userId,
      authContext.organizationId,
    );

    return ok(c, { credits });
  });
}
