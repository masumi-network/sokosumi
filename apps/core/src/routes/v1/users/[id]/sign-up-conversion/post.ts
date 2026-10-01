import { createRoute, z } from "@hono/zod-openapi";

import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { claimSignUpConversion } from "@/lib/auth-sign-up-conversion";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  signUpConversionRequestSchema,
  signUpConversionResponseSchema,
} from "@/schemas/user.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description:
      "Only the literal me is accepted, for the interactive session user.",
    example: "me",
  }),
});

const route = createRoute({
  method: "post",
  path: "/sign-up-conversion",
  description:
    "Claim the user's uncounted social sign-up so the page that claims it counts it once (GTM `sign_up`, UTM attribution). Only path `me` with an interactive session is accepted; UTM attribution is recorded atomically when supplied.",
  tags: ["Users"],
  request: {
    params,
    body: {
      required: false,
      content: {
        "application/json": { schema: signUpConversionRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      signUpConversionResponseSchema,
      "The claimed sign-up's provider, or null",
      {
        data: { provider: "google" },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    422: jsonErrorResponse("Unprocessable Entity"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const user = requireInteractiveUserAuthContext(c.var.authContext);
    if (c.req.valid("param").id !== "me") {
      throw forbidden("Sign-up conversions can only be claimed through me");
    }
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    if (resolvedUserId !== user.userId) {
      throw forbidden("You can only claim your own sign-up conversion");
    }

    return ok(
      c,
      signUpConversionResponseSchema.parse({
        provider: await claimSignUpConversion(
          resolvedUserId,
          c.req.valid("json")?.utmAttribution,
        ),
      }),
    );
  });
}
