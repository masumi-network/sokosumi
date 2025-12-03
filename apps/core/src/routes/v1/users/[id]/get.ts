import { createRoute, z } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";
import {
  creditTransactionRepository,
  userRepository,
} from "@sokosumi/database/repositories";

import { convertCentsToCredits } from "@/helpers/credits";
import { forbidden, notFound, unauthorized } from "@/helpers/error";
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
    const { user } = c.var;
    const { id } = c.req.valid("param");

    if (!user) {
      throw unauthorized("Unauthorized");
    }

    if (user.id !== id) {
      throw forbidden("You can only access your own user data");
    }

    const record = await prisma.$transaction(async (tx) => {
      const userRecord = await userRepository.getUserById(id, tx);
      if (!userRecord) {
        throw notFound("User not found");
      }

      const centsBalance = await creditTransactionRepository.getCentsByUserId(
        id,
        tx,
      );
      return {
        ...userRecord,
        credits: convertCentsToCredits(centsBalance),
      };
    });

    return ok(c, userSchema.parse(record));
  });
}
