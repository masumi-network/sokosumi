import { createRoute, z } from "@hono/zod-openapi";
import { joinFirstAndLastName } from "@sokosumi/utils";

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
import { updateUserNameSchema, userSchema } from "@/schemas/user.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "patch",
  path: "/",
  description:
    "Save the user's display name (`name`) and/or first and last name (path `me` for the signed-in user, or a user id the caller may access). First and last name go together. Without `name`, the display name is derived from them only when the user has none.",
  tags: ["Users"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: updateUserNameSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(userSchema, "The updated user"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity - Invalid body"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const { firstName, lastName, name } = c.req.valid("json");

    const user = await prisma.user.findUnique({
      where: { id: resolvedUserId },
      select: { name: true },
    });
    if (!user) {
      throw notFound("User not found");
    }

    const updated = await prisma.user.update({
      where: { id: resolvedUserId },
      data: {
        ...(firstName !== undefined && { firstName, lastName }),
        ...(name !== undefined
          ? { name }
          : !user.name.trim() &&
              firstName !== undefined &&
              lastName !== undefined
            ? { name: joinFirstAndLastName(firstName, lastName) }
            : {}),
        // The column has no @updatedAt; a change must move it.
        updatedAt: new Date(),
      },
    });

    return ok(c, userSchema.parse(updated));
  });
}
