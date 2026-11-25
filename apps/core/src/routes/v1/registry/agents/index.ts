import { createMiddleware } from "hono/factory";

import { forbidden } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { isCoworkerAuthContext, isUserAuthContext } from "@/middleware/auth";

import mountListRegistryAgents from "./get.js";

// API-key callers only: a user's Better Auth API key or a Coworker key.
// Sessions, OAuth tokens, and Soko Bot keys are refused.
const requireApiKey = createMiddleware(async (c, next) => {
  const authContext = c.var.authContext;
  const isUserApiKey =
    isUserAuthContext(authContext) &&
    authContext.authenticationMethod === "api_key";
  if (!isUserApiKey && !isCoworkerAuthContext(authContext)) {
    throw forbidden("API key required");
  }
  await next();
});

const app = new OpenAPIHonoWithAuth();

app.use("*", requireApiKey);
mountListRegistryAgents(app);

export default app;
