import { createRoute, z } from "@hono/zod-openapi";
import { utmAttributionRepository } from "@sokosumi/database/repositories";

import { internalServerError } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  utmAttributionRequestSchema,
  utmAttributionResponseSchema,
} from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "post",
  path: "/utm-attribution",
  description:
    "Record a UTM attribution conversion: path `me` for the session user, or a user id when the caller may access that user's data.",
  tags: ["Users"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: utmAttributionRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      utmAttributionResponseSchema,
      "Record a UTM attribution for the user",
      {
        data: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          convertedAt: "2025-01-01T00:00:00.000Z",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const body = c.req.valid("json");

    const attribution = await utmAttributionRepository.createUTMAttribution(
      resolvedUserId,
      body,
      prisma,
    );

    if (!attribution) {
      throw internalServerError("Failed to record UTM attribution");
    }

    return ok(
      c,
      utmAttributionResponseSchema.parse({
        id: attribution.id,
        convertedAt: attribution.convertedAt,
      }),
    );
  });
}
