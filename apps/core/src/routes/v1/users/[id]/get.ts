import { createRoute, z } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";
import { creditTransactionRepository } from "@sokosumi/database/repositories";

import { requireUserAccess } from "@/helpers/access-control";
import { convertCentsToCredits } from "@/helpers/credits";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { userSchema } from "@/schemas/user.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Users"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(userSchema, "Retrieve the user by ID"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    const user = await prisma.$transaction(async (tx) => {
      const user = await requireUserAccess(authContext.userId, id, tx);

      const centsBalance = await creditTransactionRepository.getCentsByUserId(
        user.id,
        tx,
      );
      return {
        ...user,
        credits: convertCentsToCredits(centsBalance),
      };
    });

    return ok(c, userSchema.parse(user));
  });
}
