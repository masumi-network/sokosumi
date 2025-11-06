import { createRoute, z } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";
import { Context } from "hono";

import type { Endpoint } from "@/helpers/endpoint";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { UserAuthContext } from "@/middleware/auth";

const userSchema = z
  .object({
    id: z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
    name: z.string().openapi({ example: "John Doe" }),
    email: z.string().openapi({ example: "john.doe@example.com" }),
  })
  .openapi("User");

const route = createRoute({
  method: "get",
  path: "/me",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(userSchema, "Retrieve the current user"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

async function handler(c: Context) {
  const auth = c.var.auth;

  if (auth.type !== "user") {
    forbidden("A non-user cannot access their own data");
  }

  const userAuth = auth as UserAuthContext;
  const user = await userRepository.getUserById(userAuth.userId);
  if (!user) {
    notFound("User not found");
  }

  return ok(c, userSchema.parse(user));
}

const schemas = { userSchema };

const endpoint: Endpoint<typeof schemas> = {
  schemas,
  route,
  handler,
};

export default endpoint;
