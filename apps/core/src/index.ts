import "dotenv/config";

import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";
import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";
import { getBetterAuthPublicBaseUrl, getEnv, validateEnv } from "@/config/env";
import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import {
  bindCoreRequestId,
  coreEvlogMiddleware,
  initCoreLogger,
} from "@/lib/evlog";
import { betterAuthEvlogMiddleware } from "@/lib/evlog-better-auth";
import { initSentry } from "@/lib/sentry";
import { maintenanceMiddleware } from "@/middleware/maintenance";
import { sentryMiddleware } from "@/middleware/sentry";
import authRouter from "@/routes/auth/index";
import syncRouter from "@/routes/sync/index";
import apiV1 from "@/routes/v1/index";
import wellKnownRouter from "@/routes/well-known/index";

validateEnv();
initSentry();
initCoreLogger();

// Build favicon URL - use Vercel URL in production, relative path locally
const faviconUrl = `${getBetterAuthPublicBaseUrl()}/favicon.ico`;

// Main app is exported at the end to combine OpenAPI and auth routes
const mainApp = new Hono();

const app = new OpenAPIHono<{
  Variables: RequestIdVariables;
}>();

app.use(requestId());
app.use(coreEvlogMiddleware());
app.use(bindCoreRequestId());
app.use(betterAuthEvlogMiddleware());
app.use(maintenanceMiddleware());
app.use(sentryMiddleware());

app.onError(errorHandler);

app.notFound(() => {
  throw notFound();
});

app.route("/", wellKnownRouter);
app.route("/auth", authRouter);
app.route("/v1", apiV1);
app.route("/sync", syncRouter);

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

let llmsMarkdown: string | null = null;
let llmsMarkdownPromise: Promise<string> | null = null;

async function getLlmsMarkdown(): Promise<string> {
  if (llmsMarkdown !== null) {
    return llmsMarkdown;
  }

  if (!llmsMarkdownPromise) {
    llmsMarkdownPromise = createMarkdownFromOpenApi(JSON.stringify(content))
      .then((markdown) => {
        llmsMarkdown = markdown;
        return markdown;
      })
      .catch((error) => {
        llmsMarkdownPromise = null;
        throw error;
      });
  }

  return await llmsMarkdownPromise;
}

/**
 * Register a route to serve the Markdown for LLMs
 *
 * Q: Why /llms.txt?
 * A: It's a proposal to standardise on using an /llms.txt file.
 *
 * @see https://llmstxt.org/
 */
app.get("/llms.txt", async (c) => {
  return c.text(await getLlmsMarkdown());
});

// Mount OpenAPI router at root - THIS IS IMPORTANT SO YOU CAN HAVE BOTH
// robots.txt lives on mainApp so crawlers still get Disallow during maintenance.
mainApp.get("/robots.txt", (c) => c.text("User-Agent: *\nDisallow: /\n"));
mainApp.route("/", app);

serve(
  {
    fetch: mainApp.fetch,
    port: getEnv().PORT,
    ...(getEnv().HOST ? { hostname: getEnv().HOST } : {}),
  },
  (info) => {
    const host = getEnv().HOST || "localhost";
    console.log(`Server is running on http://${host}:${info.port}`);
  },
);
