import "dotenv/config";

import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";
import { Hono } from "hono";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";
import { getBetterAuthPublicBaseUrl, getEnv } from "@/config/env";
import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { bindCoreRequestContext, coreEvlogMiddleware } from "@/lib/evlog";
import { betterAuthEvlogMiddleware } from "@/lib/evlog-better-auth";
import { withPublicScheme } from "@/lib/request-scheme";
import { initSentry } from "@/lib/sentry";
import { appleClientMinimumBuildMiddleware } from "@/middleware/apple-client-minimum-build";
import { maintenanceMiddleware } from "@/middleware/maintenance";
import { sentryMiddleware } from "@/middleware/sentry";
import authRouter from "@/routes/auth/index";
import healthRouter from "@/routes/health/index";
import imageStudioAgentRouter from "@/routes/image-studio-agent/index";
import mcpRouter from "@/routes/mcp/index";
import syncRouter from "@/routes/sync/index";
import apiV1 from "@/routes/v1/index";
import { getV1OpenApiDocument } from "@/routes/v1/openapi-document";
import falWebhooksRouter from "@/routes/webhooks/fal/image-jobs";
import wellKnownRouter from "@/routes/well-known/index";

getEnv();
initSentry();

const faviconUrl = `${getBetterAuthPublicBaseUrl()}/favicon.ico`;

const mainApp = new Hono();

const app = new OpenAPIHono<{
  Variables: RequestIdVariables;
}>();

app.use(requestId());
// Directly after requestId, which it reads, and before every other
// middleware: sentryMiddleware forks the isolation scope and redacts the raw
// request the sdk put on it. Anything registered above it captures against
// the unredacted parent scope.
app.use(sentryMiddleware());
app.use(coreEvlogMiddleware());
app.use(bindCoreRequestContext());
app.use(betterAuthEvlogMiddleware());
app.use(maintenanceMiddleware());
// `/v1` only: `/auth` keeps refreshing tokens for a build this turns away.
app.use("/v1/*", appleClientMinimumBuildMiddleware());

app.onError(errorHandler);

app.route("/", wellKnownRouter);
app.route("/health", healthRouter);
app.route("/auth", authRouter);
app.route("/v1", apiV1);
// MCP server (ADR 0076). Verifies its own audience-bound tokens, then runs
// each tool call through `/v1` in process.
app.route("/mcp", mcpRouter);
app.route("/sync", syncRouter);
// Signature-authenticated provider callback; deliberately outside /v1, which
// is the session-authenticated surface.
app.route("/webhooks", falWebhooksRouter);
// Grant-authenticated agent surface. Each handler re-checks the named user's
// current access to the named project before it does anything.
app.route("/image-studio-agent", imageStudioAgentRouter);

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

let llmsMarkdown: string | null = null;
let llmsMarkdownPromise: Promise<string> | null = null;

async function getLlmsMarkdown(): Promise<string> {
  if (llmsMarkdown !== null) {
    return llmsMarkdown;
  }

  if (!llmsMarkdownPromise) {
    llmsMarkdownPromise = createMarkdownFromOpenApi(
      JSON.stringify(getV1OpenApiDocument()),
    )
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

// robots.txt lives on mainApp so crawlers still get Disallow during maintenance.
mainApp.get("/robots.txt", (c) => c.text("User-Agent: *\nDisallow: /\n"));
mainApp.route("/", app);
// On mainApp, which dispatches every request: a notFound on `app` never runs,
// and Hono's default answers plain text. The kind tells a client that the
// operation is gone, not the resource (ADR 0053).
mainApp.notFound((c) =>
  errorHandler(notFound("Not Found", { kind: "route_not_found" }), c),
);

serve(
  {
    fetch: (request, bindings) =>
      mainApp.fetch(withPublicScheme(request, getEnv().VERCEL_ENV), bindings),
    port: getEnv().PORT,
    ...(getEnv().HOST ? { hostname: getEnv().HOST } : {}),
  },
  (info) => {
    const host = getEnv().HOST || "localhost";
    // biome-ignore lint/suspicious/noConsole: the local development banner, printed once at startup before any request; evlog is for request and background events.
    console.log(`Server is running on http://${host}:${info.port}`);
  },
);
