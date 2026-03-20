import { Hono } from "hono";
import { cors } from "hono/cors";

import { resolveCorsAllowOrigin } from "@/config/cors-allow-origin";
import { auth } from "@/lib/auth.js";

const app = new Hono();

// CORS for auth routes (credentials require a concrete Allow-Origin, not "*")
app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsAllowOrigin(origin),
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
