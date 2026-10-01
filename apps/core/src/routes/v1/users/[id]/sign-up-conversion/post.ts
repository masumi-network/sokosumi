import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { claimSignUpConversion } from "@/lib/auth-sign-up-conversion";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { signUpConversionResponseSchema } from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "post",
  path: "/sign-up-conversion",
  description:
    "Claim the user's uncounted social sign-up so the page that claims it counts it once (GTM `sign_up`, UTM attribution). Path `me` for the session user.",
  tags: ["Users"],
  request: {
    params,
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
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    return ok(
      c,
      signUpConversionResponseSchema.parse({
        provider: await claimSignUpConversion(resolvedUserId),
      }),
    );
  });
}
