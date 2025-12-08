import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";

import { getEnv } from "@/config/env.js";
import { auth } from "@/lib/auth.js";

import agentsRouter from "./agents/index.js";
import jobsRouter from "./jobs/index.js";
import usersRouter from "./users/index.js";

const app = new OpenAPIHono();

app.doc("/openapi.json", {
  openapi: "3.0.3",
  info: {
    version: "1.0.0",
    title: "Sokosumi API",
  },
  servers: [
    {
      url: `https://api.sokosumi.com/`,
      description: "Mainnet Server",
    },
    {
      url: `https://preprod.api.sokosumi.com/`,
      description: "Pre-production Server",
    },
  ],
  security: [{ bearerAuth: [] }],
});

app.use(
  "/auth/*",
  cors({
    origin: getEnv().BETTER_AUTH_TRUSTED_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

// Mount Routes
app.route("/agents", agentsRouter);
app.route("/users", usersRouter);
app.route("/jobs", jobsRouter);

export default app;
