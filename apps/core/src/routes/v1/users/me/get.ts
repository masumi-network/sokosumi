import { createRoute } from "@hono/zod-openapi";
import { userRepository } from "@sokosumi/database/repositories";
import { Context } from "hono";

import type { Endpoint } from "@/helpers/endpoint";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { UserAuth } from "@/middleware/auth";

import { userSchema } from "../schemas";

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

  const userAuth = auth as UserAuth;
  const user = await userRepository.getUserById(userAuth.userId);
  if (!user) {
    notFound("User not found");
  }

  return ok(c, userSchema.parse(user));
}

const schemas = { response: userSchema };

const endpoint: Endpoint<typeof schemas> = {
  schemas,
  route,
  handler,
};

export default endpoint;
