import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";

import agentsRouter from "./agents/index.js";
import conversationsRouter from "./conversations/index.js";
import coworkersRouter from "./coworkers/index.js";
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
      url: `https://api.sokosumi.com/v1`,
      description: "Mainnet Server",
    },
    {
      url: `https://preprod.api.sokosumi.com/v1`,
      description: "Pre-production Server",
    },
  ],
  security: [{ bearerAuth: [] }],
});

// CORS for all API routes
app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "X-Organization-Slug"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: false,
  }),
);

// Mount Routes
app.route("/agents", agentsRouter);
app.route("/conversations", conversationsRouter);
app.route("/users", usersRouter);
app.route("/organizations", organizationsRouter);
app.route("/jobs", jobsRouter);
app.route("/coworkers", coworkersRouter);
app.route("/tasks", tasksRouter);

export default app;
