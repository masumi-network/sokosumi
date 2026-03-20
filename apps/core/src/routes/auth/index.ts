import { Hono } from "hono";
import { cors } from "hono/cors";

import { TIME } from "@/config/constants";
import { resolveCorsAllowOrigin } from "@/config/cors-allow-origin";
import { auth } from "@/lib/auth.js";

const app = new Hono();
const oauthCors = cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["POST", "GET", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: TIME.CORS_MAX_AGE,
  credentials: false,
});
const strictAuthCors = cors({
  origin: (origin) => resolveCorsAllowOrigin(origin),
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["POST", "GET", "OPTIONS"],
  exposeHeaders: ["Content-Length"],
  maxAge: TIME.CORS_MAX_AGE,
  credentials: true,
});

// OAuth2 endpoints can be used by non-first-party clients.
app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/auth/oauth2/")) {
    return await oauthCors(c, next);
  } else {
    return await strictAuthCors(c, next);
  }
});

// Mount Auth routes
app.on(["POST", "GET"], "*", (c) => {
  return auth.handler(c.req.raw);
});

export default app;
