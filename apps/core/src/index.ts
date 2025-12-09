import "dotenv/config";

import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { logger } from "hono/logger";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";

import { getEnv, validateEnv } from "@/config/env";
import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { initI18next } from "@/lib/i18next";
import { initSentry } from "@/lib/sentry";
import { sentryMiddleware } from "@/middleware/sentry";
import authRouter from "@/routes/auth/index";
import apiV1 from "@/routes/v1/index";

validateEnv();
initSentry();
await initI18next();

// Main app is exported at the end to combine OpenAPI and auth routes
const mainApp = new Hono();

const app = new OpenAPIHono<{
  Variables: RequestIdVariables;
}>();

app.use(logger());
app.use(requestId());
app.use(sentryMiddleware());

app.onError(errorHandler);

app.notFound(() => {
  throw notFound();
});

app.route("/auth", authRouter);
app.route("/v1", apiV1);

app.get(
  "/",
  Scalar({
    pageTitle: "Sokosumi API Documentation",
    sources: [
      { url: "/v1/openapi.json", title: "v1" },
      { url: "/auth/open-api/generate-schema", title: "Better Auth" },
    ],
    defaultOpenAllTags: true,
    layout: "modern",
    theme: "saturn",
  }),
);

// Mount OpenAPI router at root - THIS IS IMPORTANT SO YOU CAN HAVE BOTH
mainApp.route("/", app);

serve(
  {
    fetch: mainApp.fetch,
    port: getEnv().PORT,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
