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
import { userSchema } from "@/schemas/user.schema";
import { updateUserNameSchema } from "@/schemas/user-workspace.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "patch",
  path: "/",
  description:
    "Save the user's first and last name (path `me` for the session user, or a user id the caller may access). The display name is derived from them only when the user has none; after that it is theirs to edit. Session users only.",
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
    const { firstName, lastName } = c.req.valid("json");

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
        firstName,
        lastName,
        ...(user.name.trim()
          ? {}
          : { name: joinFirstAndLastName(firstName, lastName) }),
      },
    });

    return ok(c, userSchema.parse(updated));
  });
}
