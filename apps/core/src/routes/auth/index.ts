import { Hono } from "hono";
import { cors } from "hono/cors";

import { getWebAppBaseUrl } from "@/config/env.js";
import { auth } from "@/lib/auth.js";

const app = new Hono();

// CORS for auth routes (with credentials and specific origin)
app.use(
  "*",
  cors({
    origin: getWebAppBaseUrl(),
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
