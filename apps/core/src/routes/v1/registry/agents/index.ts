import { createMiddleware } from "hono/factory";

import { forbidden, tooManyRequests } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { incrementRedisRateLimit } from "@/lib/redis-rate-limit";
import { isCoworkerAuthContext, isUserAuthContext } from "@/middleware/auth";

import mountListRegistryAgents from "./get.js";

/**
 * Each read calls the Masumi registry with Sokosumi's own registry key, and
 * Coworker keys skip Better Auth's API-key rate limit. Counted per user or
 * Coworker, not per key, so extra keys do not widen the budget.
 */
export const REGISTRY_READS_PER_MINUTE = 60;
const REGISTRY_READ_WINDOW_SECONDS = 60;

// API-key callers only: a user's Better Auth API key or a Coworker key.
// Sessions, OAuth tokens, and Soko Bot keys are refused.
const requireApiKey = createMiddleware(async (c, next) => {
  const authContext = c.var.authContext;
  const isUserApiKey =
    isUserAuthContext(authContext) &&
    authContext.authenticationMethod === "api_key";
  let principal: string;
  if (isUserApiKey) {
    principal = `user:${authContext.userId}`;
  } else if (isCoworkerAuthContext(authContext)) {
    principal = `coworker:${authContext.coworkerId}`;
  } else {
    throw forbidden("API key required");
  }
  // Fails open without Redis, like Core's other read budgets.
  const count = await incrementRedisRateLimit(
    `registry:agents-read:${principal}`,
    REGISTRY_READ_WINDOW_SECONDS,
  );
  if (typeof count === "number" && count > REGISTRY_READS_PER_MINUTE) {
    throw tooManyRequests(
      `Registry agents can be read ${REGISTRY_READS_PER_MINUTE} times per minute. Try again later.`,
      { retryAfterSeconds: REGISTRY_READ_WINDOW_SECONDS },
    );
  }
  await next();
});

const app = new OpenAPIHonoWithAuth();

app.use("*", requireApiKey);
mountListRegistryAgents(app);

export default app;
