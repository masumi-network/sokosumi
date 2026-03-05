import { Hono } from "hono";
import { cors } from "hono/cors";

import { getEnv } from "@/config/env.js";
import { auth } from "@/lib/auth.js";

const app = new Hono();

// CORS for auth routes (with credentials and dynamic origin)
// Better Auth handles trusted origins via baseURL.allowedHosts
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) {
        return getEnv().BETTER_AUTH_TRUSTED_ORIGIN;
      }
      // Check if origin matches allowed hosts pattern
      const env = getEnv();
      try {
        const originUrl = new URL(origin);
        const trustedOriginUrl = new URL(env.BETTER_AUTH_TRUSTED_ORIGIN);
        // Allow exact match or Vercel preview deployments
        if (
          originUrl.hostname === trustedOriginUrl.hostname ||
          originUrl.hostname.endsWith(".vercel.app") ||
          originUrl.hostname === "localhost"
        ) {
          return origin;
        }
      } catch {
        // If URL parsing fails, fall back to trusted origin
      }
      return getEnv().BETTER_AUTH_TRUSTED_ORIGIN;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

// Mount Auth routes
app.on(["POST", "GET"], "*", (c) => {
  return auth.handler(c.req.raw);
});

export default app;
