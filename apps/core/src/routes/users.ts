import { userRepository } from "@sokosumi/database/repositories";
import { Hono } from "hono";

import { notFound } from "../helpers/error";
import { ok } from "../helpers/response";

const router = new Hono();

router.get("/users/:id", async (c) => {
  const id = c.req.param("id");
  const user = await userRepository.getUserById(id);
  if (!user) {
    throw notFound("User not found", { code: "USER_NOT_FOUND" });
  }

  return ok(c, { user });
});

export default router;
