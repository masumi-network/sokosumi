import { createMiddleware } from "hono/factory";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import invoicesRouter from "./invoices/index.js";
import organizationsRouter from "./organizations/index.js";
import searchRouter from "./search/index.js";
import tasksRouter from "./tasks/index.js";
import usersRouter from "./users/index.js";

const requireAdmin = createMiddleware(async (c, next) => {
  requireAdminAuthContext(c.var.authContext);
  await next();
});

const app = new OpenAPIHonoWithAuth();

app.use("*", requireAdmin);
app.route("/search", searchRouter);
app.route("/users", usersRouter);
app.route("/organizations", organizationsRouter);
app.route("/invoices", invoicesRouter);
app.route("/tasks", tasksRouter);

export default app;
