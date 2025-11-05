import { userRepository } from "@sokosumi/database/repositories";

import { forbidden, notFound } from "../helpers/error";
import { ok } from "../helpers/response";
import { OpenAPIHonoWithAuth } from "../lib/hono";
import type { UserAuthContext } from "../middleware/auth";

const app = new OpenAPIHonoWithAuth();

app.get("/me", async (c) => {
  const auth = c.get("auth");

  // Check if the user is authenticated
  if (auth.type !== "user") {
    forbidden("Internal tokens cannot access user data");
  }

  // TypeScript control flow doesn't always recognize thrown errors
  // Safe to assert as UserAuthContext after the check above
  const userAuth = auth as UserAuthContext;
  const user = await userRepository.getUserById(userAuth.userId);
  if (!user) {
    notFound("User not found");
  }

  return ok(c, { user });
});

app.get("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  // Authorization: users can only access their own ID
  // Internal service token has full access
  if (auth.type === "user" && auth.userId !== id) {
    forbidden("You can only access your own user data");
  }

  const user = await userRepository.getUserById(id);
  if (!user) {
    notFound("User not found");
  }

  return ok(c, { user });
});

export default app;
