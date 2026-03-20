import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";

import { TIME } from "@/config/constants.js";
import { resolveCorsAllowOrigin } from "@/config/cors-allow-origin.js";
import { getBetterAuthPublicBaseUrl } from "@/config/env.js";

import agentsRouter from "./agents/index.js";
import categoriesRouter from "./categories/index.js";
import conversationsRouter from "./conversations/index.js";
import coworkersRouter from "./coworkers/index.js";
import creditCostsRouter from "./credit-costs/index.js";
import jobsRouter from "./jobs/index.js";
import organizationsRouter from "./organizations/index.js";
import tasksRouter from "./tasks/index.js";
import usersRouter from "./users/index.js";

const app = new OpenAPIHono();

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description:
    "Authentication required for all endpoints. Supports Better Auth user credentials and dedicated coworker bearer API keys.",
});

app.openAPIRegistry.registerComponent("parameters", "OrganizationSlug", {
  name: "X-Organization-Slug",
  in: "header",
  description: "Optional organization slug to set the organization context.",
  required: false,
  schema: {
    type: "string",
    example: "my-organization-slug",
  },
});

app.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    version: "1.0.0",
    title: "Sokosumi API",
    description: "Sokosumi API documentation.",
  },
  servers: [
    {
      url: getBetterAuthPublicBaseUrl(),
    },
  ],
  security: [{ bearerAuth: [] }],
});

app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsAllowOrigin(origin),
    allowHeaders: ["Content-Type", "Authorization", "X-Organization-Slug"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: TIME.CORS_MAX_AGE,
    credentials: true,
  }),
);

// Mount Routes
app.route("/agents", agentsRouter);
app.route("/categories", categoriesRouter);
app.route("/conversations", conversationsRouter);
app.route("/credit-costs", creditCostsRouter);
app.route("/users", usersRouter);
app.route("/organizations", organizationsRouter);
app.route("/jobs", jobsRouter);
app.route("/coworkers", coworkersRouter);
app.route("/tasks", tasksRouter);

export default app;
