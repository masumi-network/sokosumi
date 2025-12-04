import "dotenv/config";

import { serve } from "@hono/node-server";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";

import { notFound } from "@/helpers/error";
import apiV1 from "@/routes/v1/index";

const app = new OpenAPIHono<{ Variables: RequestIdVariables }>();

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

app.use(logger());
app.use(requestId());
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    exposeHeaders: ["X-Request-Id"],
    maxAge: 86400,
  }),
);

app.notFound(() => {
  throw notFound();
});

// Mount API v1 routes
app.route("/v1", apiV1);

// Generate OpenAPI spec from the API routes (publicly accessible)
app.doc("/openapi.json", {
  openapi: "3.0.3",
  info: {
    version: "1.0.0",
    title: "Sokosumi API",
  },
  servers: [
    {
      url: `https://api.sokosumi.com/`,
      description: "Production Server",
    },
    {
      url: `https://preprod.api.sokosumi.com/`,
      description: "Pre-production Server",
    },
  ],
  security: [{ bearerAuth: [] }],
});
app.get(
  "/",
  swaggerUI({
    url: "openapi.json",
    persistAuthorization: true,
    withCredentials: true,
    tryItOutEnabled: true,
  }),
);

serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT) || 8787,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
