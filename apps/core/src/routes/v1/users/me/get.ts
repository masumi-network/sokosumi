import { createRoute } from "@hono/zod-openapi";
import prisma from "@sokosumi/database/client";
import {
  creditTransactionRepository,
  userRepository,
} from "@sokosumi/database/repositories";

import { convertCentsToCredits } from "@/helpers/credits";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
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
        name: "John Doe",
        email: "john.doe@example.com",
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
    const { user } = c.var;

    const record = await prisma.$transaction(async (tx) => {
      const userRecord = await userRepository.getUserById(user.id, tx);
      if (!userRecord) {
        throw notFound("User not found");
      }

      const centsBalance = await creditTransactionRepository.getCentsByUserId(
        user.id,
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
