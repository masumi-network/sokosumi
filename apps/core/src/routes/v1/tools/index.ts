import { createMiddleware } from "hono/factory";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

import mountSiteIcon from "./site-icon/get.js";

const requireUser = createMiddleware(async (c, next) => {
  requireUserAuthContext(c.var.authContext);
  await next();
});

const app = new OpenAPIHonoWithAuth();

app.use("*", requireUser);
mountSiteIcon(app);

export default app;
