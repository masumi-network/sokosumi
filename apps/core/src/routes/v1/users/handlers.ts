import { userRepository } from "@sokosumi/database/repositories";
import { Context } from "hono";

import { forbidden, notFound } from "@/helpers/error";
import { ok } from "@/helpers/response";
import { UserAuthContext } from "@/middleware/auth";

import { userSchema } from "./schemas";

export async function getUserHandler(c: Context) {
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

export async function getMeHandler(c: Context) {
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
