import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";

import { getEnv } from "@/config/env.js";

import agentsRouter from "./agents/index.js";
import jobsRouter from "./jobs/index.js";
import usersRouter from "./users/index.js";

const app = new OpenAPIHono();

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

app.doc("/openapi.json", {
  openapi: "3.0.3",
  info: {
    version: "1.0.0",
    title: "Sokosumi API",
  },
  servers: [
    {
      url: `https://api.sokosumi.com/v1`,
      description: "Mainnet Server",
    },
    {
      url: `https://preprod.api.sokosumi.com/v1`,
      description: "Pre-production Server",
    },
    ...(getEnv().NODE_ENV === "development"
      ? [
          {
            url: `http://localhost:8787/v1`,
            description: "Local Development Server",
          },
        ]
      : []),
  ],
  security: [{ bearerAuth: [] }],
});

// CORS for all API routes
app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: false,
  }),
);

// Mount Routes
app.route("/agents", agentsRouter);
app.route("/users", usersRouter);
app.route("/jobs", jobsRouter);

export default app;
