import { userRepository } from "@sokosumi/database/repositories";
import { Hono } from "hono";

import { notFound } from "../helpers/error";
import { ok } from "../helpers/response";
import { AuthContext, requireAuth } from "../middleware/auth";

const router = new Hono<{ Variables: { auth: AuthContext } }>();

router.use("*", requireAuth);

router.get("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  // Authorization: users can only access their own ID
  // Internal service token has full access
  if (auth.type === "user" && auth.userId !== id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const user = await userRepository.getUserById(id);
  if (!user) {
    notFound("User not found");
  }

  return ok(c, { user });
});

export default router;
