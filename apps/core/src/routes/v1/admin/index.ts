import { createMiddleware } from "hono/factory";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import agentsRouter from "./agents/index.js";
import creditsRouter from "./credits/index.js";
import invoicesRouter from "./invoices/index.js";
import matchedChannelsRouter from "./matched-channels/index.js";
import organizationsRouter from "./organizations/index.js";
import searchRouter from "./search/index.js";
import sokoBotsRouter from "./soko-bots/index.js";
import taskPaymentClaimsRouter from "./task-payment-claims/index.js";
import taskX402PaymentsRouter from "./task-x402-payments/index.js";
import tasksRouter from "./tasks/index.js";
import usersRouter from "./users/index.js";
import vendorsRouter from "./vendors/index.js";

const requireAdmin = createMiddleware(async (c, next) => {
  requireAdminAuthContext(c.var.authContext);
  await next();
});

// Note: ./impersonation is mounted from the v1 router *before* this
// router — `use("*")` flattens to `/admin/*` on the parent and would
// 403 stop otherwise. See the mount comment in ../index.ts.

const app = new OpenAPIHonoWithAuth();

app.use("*", requireAdmin);
app.route("/agents", agentsRouter);
app.route("/search", searchRouter);
app.route("/soko-bots", sokoBotsRouter);
app.route("/users", usersRouter);
app.route("/matched-channels", matchedChannelsRouter);
app.route("/organizations", organizationsRouter);
app.route("/invoices", invoicesRouter);
app.route("/credits", creditsRouter);
app.route("/tasks", tasksRouter);
app.route("/task-payment-claims", taskPaymentClaimsRouter);
app.route("/task-x402-payments", taskX402PaymentsRouter);
app.route("/vendors", vendorsRouter);

export default app;
