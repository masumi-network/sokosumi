import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";

import { errorHandler } from "@/helpers/error-handler";

import agentsRouter from "./agents/index.js";
import usersRouter from "./users/index.js";

const app = new OpenAPIHono<{ Variables: RequestIdVariables }>();

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

app.onError(errorHandler);

// Mount Routes
app.route("/agents", agentsRouter);
app.route("/users", usersRouter);

// Generate OpenAPI spec from the API routes (publicly accessible)
app.doc("/openapi.json", {
  openapi: "3.0.3",
  info: {
    version: "1.0.0",
    title: "Sokosumi API",
  },
  servers: [
    {
      url: `http://localhost:8787/v1`,
      description: "Local Server",
    },
  ],
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

export default app;
