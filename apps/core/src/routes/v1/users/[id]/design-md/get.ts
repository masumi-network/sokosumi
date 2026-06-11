import { createRoute, z } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";

import { readUserDesignMd } from "@/helpers/design-md";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { persistedDesignMdSchema } from "@/schemas/design-md.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/design-md",
  description:
    "Get the user's own stored DESIGN.md (path `me` or a user id when the caller may access that user's data). `designMd` is null when none is set.",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      persistedDesignMdSchema,
      "The user's stored DESIGN.md (null when none)",
      {
        data: {
          designMd: {
            url: "https://blob.example/design.md",
            extractionId: "12345",
          },
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const user = await userRepository.getUserById(resolvedUserId, prisma);
    if (!user) {
      throw notFound("User not found");
    }

    return ok(
      c,
      persistedDesignMdSchema.parse({
        designMd: readUserDesignMd(user.metadata),
      }),
    );
  });
}
