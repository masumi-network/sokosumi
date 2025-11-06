import { createRoute, z } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";
import { Context } from "hono";

import type { Endpoint } from "@/helpers/endpoint";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";

const userSchema = z
  .object({
    id: z.string().openapi({ example: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj" }),
    name: z.string().openapi({ example: "John Doe" }),
    email: z.string().openapi({ example: "john.doe@example.com" }),
  })
  .openapi("User");

const userIdSchema = z.object({
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
    params: userIdSchema,
  },
  responses: {
    200: jsonSuccessResponse(userSchema, "Retrieve the user by ID"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

async function handler(c: Context) {
  const auth = c.var.auth;

  const id = c.req.param("id");

  if (auth.type === "user" && auth.userId !== id) {
    forbidden("You can only access your own user data");
  }

  const user = await userRepository.getUserById(id);
  if (!user) {
    notFound("User not found");
  }

  return ok(c, userSchema.parse(user));
}

const schemas = { userSchema, userIdSchema };

const endpoint: Endpoint<typeof schemas> = {
  schemas,
  route,
  handler,
};

export default endpoint;
