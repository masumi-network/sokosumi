import { createRoute, z } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";
import { Context } from "hono";

import type { Endpoint } from "@/helpers/endpoint";
import { errorResponseSchema, forbidden, notFound } from "@/helpers/error";
import { ok, successResponseSchema } from "@/helpers/response";

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
    200: {
      content: {
        "application/json": {
          schema: successResponseSchema(userSchema),
        },
      },
      description: "Retrieve the user by ID",
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    403: {
      description: "Forbidden",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    404: {
      description: "Not Found",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
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
  tags: ["Users"],
};

export default endpoint;
