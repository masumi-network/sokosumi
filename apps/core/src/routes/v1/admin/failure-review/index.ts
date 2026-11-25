import { createMiddleware } from "hono/factory";
import { getEnv } from "@/config/env";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  isCoworkerAuthContext,
  requireAdminAuthContext,
} from "@/middleware/auth";
import mountGetFailureReview from "./get.js";

/**
 * Platform admins, or a listed coworker's own key without user context:
 * CodePat reads the weekly review with its key and nothing else admin.
 */
const requireReviewer = createMiddleware(async (c, next) => {
  const authContext = c.var.authContext;
  const listedCoworker =
    isCoworkerAuthContext(authContext) &&
    !authContext.context &&
    getEnv().FAILURE_REVIEW_COWORKER_IDS.includes(authContext.coworkerId);
  if (!listedCoworker) requireAdminAuthContext(authContext);
  await next();
});

const app = new OpenAPIHonoWithAuth();

app.use("*", requireReviewer);
mountGetFailureReview(app);

export default app;
