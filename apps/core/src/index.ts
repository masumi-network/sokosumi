import "dotenv/config";

import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
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
    exposeHeaders: ["X-Request-Id", "Content-Length"],
    maxAge: 86400,
  }),
);

app.notFound(() => {
  throw notFound();
});

app.route("/v1", apiV1);

app.get(
  "/",
  Scalar({
    pageTitle: "Sokosumi API Documentation",
    sources: [
      { url: "/v1/openapi.json", title: "Content" },
      { url: "/v1/auth/open-api/generate-schema", title: "Auth" },
    ],
    defaultOpenAllTags: true,
    layout: "modern",
    theme: "saturn",
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
