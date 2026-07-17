import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";

import { TIME } from "@/config/constants.js";
import { resolveCorsAllowOrigin } from "@/config/cors-allow-origin.js";

import adminRouter from "./admin/index.js";
import agentsRouter from "./agents/index.js";
import categoriesRouter from "./categories/index.js";
import chatRouter from "./chat/index.js";
import checkoutRouter from "./checkout/index.js";
import conversationsRouter from "./conversations/index.js";
import couponsRouter from "./coupons/index.js";
import coworkersRouter from "./coworkers/index.js";
import creditCostsRouter from "./credit-costs/index.js";
import enterpriseRouter from "./enterprise/index.js";
import hermesRouter from "./hermes/index.js";
import historyRouter from "./history/index.js";
import invitationsRouter from "./invitations/index.js";
import jobsRouter from "./jobs/index.js";
import notificationsRouter from "./notifications/index.js";
import orchestratorsRouter from "./orchestrators/index.js";
import organizationsRouter from "./organizations/index.js";
import productsRouter from "./products/index.js";
import projectsRouter from "./projects/index.js";
import shareRouter from "./share/index.js";
import tasksRouter from "./tasks/index.js";
import usersRouter from "./users/index.js";
import vendorsRouter from "./vendors/index.js";
import workspacesRouter from "./workspaces/index.js";

const app = new OpenAPIHono();

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description:
    "Authentication required for all endpoints. Supports Better Auth user credentials, dedicated coworker bearer API keys (`coworker_`), and orchestrator bearer API keys (`orch_`).",
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

app.openAPIRegistry.registerComponent("parameters", "ContextUserId", {
  name: "X-Context-User-Id",
  in: "header",
  description:
    "Optional workspace user id when authenticating as a coworker or orchestrator API key. Selects which user workspace the request runs in for user-scoped operations. Must be set if X-Context-Organization-Id is present.",
  required: false,
  schema: {
    type: "string",
    example: "user_abc123",
  },
});

app.openAPIRegistry.registerComponent("parameters", "ContextOrganizationId", {
  name: "X-Context-Organization-Id",
  in: "header",
  description:
    "Optional workspace organization id when authenticating as a coworker or orchestrator API key. Requires X-Context-User-Id; the user must be a member of this organization.",
  required: false,
  schema: {
    type: "string",
    example: "org_xyz789",
  },
});

app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsAllowOrigin(origin),
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Organization-Slug",
      "X-Context-User-Id",
      "X-Context-Organization-Id",
      "X-Delegation-User-Id",
      "X-Delegation-Organization-Id",
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: TIME.CORS_MAX_AGE,
    credentials: true,
  }),
);

app.doc31("/openapi.json", {
  openapi: "3.1.0",
  info: {
    version: "1.0.0",
    title: "Sokosumi API",
    description: "Sokosumi API documentation.",
  },
  servers: [
    {
      url: "/v1",
    },
  ],
  security: [{ bearerAuth: [] }],
});

// Mount Routes
app.route("/admin", adminRouter);
app.route("/agents", agentsRouter);
app.route("/categories", categoriesRouter);
app.route("/chat", chatRouter);
app.route("/checkout", checkoutRouter);
app.route("/conversations", conversationsRouter);
app.route("/coupons", couponsRouter);
app.route("/credit-costs", creditCostsRouter);
app.route("/enterprise", enterpriseRouter);
app.route("/hermes", hermesRouter);
app.route("/history", historyRouter);
app.route("/users", usersRouter);
app.route("/organizations", organizationsRouter);
app.route("/projects", projectsRouter);
app.route("/jobs", jobsRouter);
app.route("/notifications", notificationsRouter);
app.route("/invitations", invitationsRouter);
app.route("/share", shareRouter);
app.route("/coworkers", coworkersRouter);
app.route("/orchestrators", orchestratorsRouter);
app.route("/tasks", tasksRouter);
app.route("/products", productsRouter);
app.route("/vendors", vendorsRouter);
app.route("/workspaces", workspacesRouter);

export default app;
