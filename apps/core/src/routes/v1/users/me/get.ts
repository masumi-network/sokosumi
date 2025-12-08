import { createRoute } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { getUserWithCredits } from "@/helpers/user";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { userSchema } from "@/schemas/user.schema";

const route = createRoute({
  method: "get",
  path: "/me",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(userSchema, "Retrieve the current user", {
      data: {
        id: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
        name: "John Doe",
        email: "john.doe@example.com",
        image: "https://example.com/image.png",
        credits: 100.0,
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;

    const user = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: authContext.userId },
      });
      if (!user) {
        throw notFound("User not found");
      }
      return await getUserWithCredits(user, tx);
    });

    return ok(c, userSchema.parse(user));
  });
}
