import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId, RequestIdVariables } from "hono/request-id";

import { env } from "./config/env";
import { errorHandler } from "./helpers/error-handler";
import agentsRouter from "./routes/agents";
import usersRouter from "./routes/users";

// const app = new Hono<{ Variables: RequestIdVariables }>();

// Protected API routes
const app = new OpenAPIHono<{ Variables: RequestIdVariables }>().basePath(
  "/api/v1",
);
app.use(logger());
app.use(requestId());
app.use("*", cors());

// Centralized error handler
app.onError(errorHandler);

app.openAPIRegistry.registerComponent(
  "securitySchemes",
  "Bearer Authentication",
  {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  },
);

// Mount protected routes (auth middleware applied in routes)
app.route("/agents", agentsRouter);
app.route("/users", usersRouter);

// Generate OpenAPI spec from the API routes (publicly accessible)
app.doc("/openapi.json", {
  openapi: "3.0.3",
  info: {
    version: "1.0.0",
    title: "Sokosumi API",
  },
  security: [{ bearerAuth: [] }],
});
app.get(
  "/doc",
  swaggerUI({
    url: "openapi.json",
    persistAuthorization: true,
    withCredentials: true,
    tryItOutEnabled: true,
  }),
);

// Mount api routes at /api/v1
// app.route("/api/v1", api);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
