import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { logger } from "hono/logger";

import { env } from "./config/env";
import { errorHandler } from "./helpers/error-handler";
import agentsRouter from "./routes/agents";
import usersRouter from "./routes/users";

const app = new Hono();
app.use(logger());

// Centralized error handler
app.onError(errorHandler);

// Protected API routes
const api = new OpenAPIHono();

// Auth Middleware
const authMiddleware = bearerAuth({
  token: env.API_KEY,
});

// Apply auth to API routes only (not the doc endpoint)
api.use("/agents/*", authMiddleware);
api.use("/users/*", authMiddleware);

// Mount protected routes
api.route("/agents", agentsRouter);
api.route("/users", usersRouter);

// Generate OpenAPI spec from the API routes (publicly accessible)
api.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "Sokosumi API",
  },
});

// Mount api routes at /api/v1
app.route("/api/v1", api);

// Public documentation UI (no auth required)
app.get("/docs/v1", swaggerUI({ url: "/api/v1/openapi.json" }));

export default {
  port: env.PORT,
  fetch: app.fetch,
};
