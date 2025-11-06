import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";

import { env } from "./config/env";
import { errorHandler } from "./helpers/error-handler";
import agentsRouter from "./routes/agents";
import usersRouter from "./routes/users";

const app = new Hono();
app.use(logger());
app.use(requestId());
app.use("*", cors());

// Centralized error handler
app.onError(errorHandler);

// Protected API routes
const api = new OpenAPIHono();

// Mount protected routes (auth middleware applied in routes)
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
api.get("/doc", swaggerUI({ url: "openapi.json" }));

// Mount api routes at /api/v1
app.route("/api/v1", api);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
