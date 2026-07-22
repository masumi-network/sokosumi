import { createMiddleware } from "hono/factory";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

import tasksRouter from "./tasks/index.js";

const requireUser = createMiddleware(async (c, next) => {
  requireUserAuthContext(c.var.authContext);
  await next();
});

const app = new OpenAPIHonoWithAuth();

app.use("*", requireUser);
app.route("/tasks", tasksRouter);

export default app;
