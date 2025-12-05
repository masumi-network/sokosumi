import "dotenv/config";

import { serve } from "@hono/node-server";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";

import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { initSentry } from "@/lib/sentry";
import { sentryMiddleware } from "@/middleware/sentry";
import apiV1 from "@/routes/v1/index";

initSentry();

const app = new OpenAPIHono<{ Variables: RequestIdVariables }>();

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

app.onError(errorHandler);

app.use(logger());
app.use(requestId());
app.use(sentryMiddleware());
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

app.route("/v1", apiV1);

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
