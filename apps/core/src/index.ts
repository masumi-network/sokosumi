import "dotenv/config";

import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";
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

// Build favicon URL - use Vercel URL in production, relative path locally
const faviconUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}/favicon.ico`
  : undefined;

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
    favicon: faviconUrl,
    sources: [
      { url: "/v1/openapi.json", title: "v1" },
      { url: "/auth/open-api/generate-schema", title: "Better Auth" },
    ],
    persistAuth: true,
    hideClientButton: true,
    defaultOpenAllTags: true,
    layout: "modern",
    theme: "saturn",
  }),
);

// Markdown documentation
const content = apiV1.getOpenAPI31Document({
  openapi: "3.1.0",
  info: {
    title: "Sokosumi API",
    version: "1.0.0",
    description: "Sokosumi API documentation",
  },
});

const markdown = await createMarkdownFromOpenApi(JSON.stringify(content));

/**
 * Register a route to serve the Markdown for LLMs
 *
 * Q: Why /llms.txt?
 * A: It's a proposal to standardise on using an /llms.txt file.
 *
 * @see https://llmstxt.org/
 */
app.get("/llms.txt", async (c) => {
  return c.text(markdown);
});

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
