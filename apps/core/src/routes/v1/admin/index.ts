import { createMiddleware } from "hono/factory";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";

import organizationsRouter from "./organizations/index.js";
import usersRouter from "./users/index.js";

const requireAdmin = createMiddleware(async (c, next) => {
  requireAdminAuthContext(c.var.authContext);
  await next();
});

const app = new OpenAPIHonoWithAuth();

app.use("*", requireAdmin);
app.route("/users", usersRouter);
app.route("/organizations", organizationsRouter);

export default app;
