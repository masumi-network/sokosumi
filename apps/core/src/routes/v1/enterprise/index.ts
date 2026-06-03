import { createMiddleware } from "hono/factory";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";

import contractsRouter from "./contracts/index.js";

const requireEnterpriseAdmin = createMiddleware(async (c, next) => {
  requireAdminAuthContext(c.var.authContext);
  await next();
});

const app = new OpenAPIHonoWithAuth();

app.use("*", requireEnterpriseAdmin);
app.route("/contracts", contractsRouter);

export default app;
