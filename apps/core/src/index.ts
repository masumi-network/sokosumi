import "dotenv/config";

import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";
import { Hono } from "hono";
import { logger } from "hono/logger";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";

import { getBetterAuthPublicBaseUrl, getEnv, validateEnv } from "@/config/env";
import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { initSentry } from "@/lib/sentry";
import { maintenanceMiddleware } from "@/middleware/maintenance";
import { sentryMiddleware } from "@/middleware/sentry";
import authRouter from "@/routes/auth/index";
import debugRouter from "@/routes/debug/index";
import syncRouter from "@/routes/sync/index";
import apiV1 from "@/routes/v1/index";
import webhooksRouter from "@/routes/webhooks/index";
import wellKnownRouter from "@/routes/well-known/index";
import { hermesInboxSyncService } from "@/services/hermes-inbox-sync.service";

validateEnv();
initSentry();

// Build favicon URL - use Vercel URL in production, relative path locally
const faviconUrl = `${getBetterAuthPublicBaseUrl()}/favicon.ico`;

// Main app is exported at the end to combine OpenAPI and auth routes
const mainApp = new Hono();

const app = new OpenAPIHono<{
  Variables: RequestIdVariables;
}>();

app.use(logger());
app.use(requestId());
app.use(maintenanceMiddleware());
app.use(sentryMiddleware());

app.onError(errorHandler);

app.notFound(() => {
  throw notFound();
});

app.route("/", wellKnownRouter);
app.route("/auth", authRouter);
app.route("/v1", apiV1);
app.route("/debug", debugRouter);
app.route("/sync", syncRouter);
app.route("/webhooks", webhooksRouter);

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

/**
 * Dev-only inbox poll loop.
 *
 * In production, Vercel cron pings /sync/hermes/poll-inboxes. There's no cron
 * locally, so welcome messages and any other orchestrator-pushed inbox traffic
 * never lands in our DB unless someone hits the route by hand. Wire a simple
 * interval that calls the service directly when running in dev with polling
 * enabled, so the local Hermes flow matches production behaviour.
 *
 * Gated on NODE_ENV === "development" so this never accidentally runs in prod
 * alongside the cron and double-polls.
 */
if (
  getEnv().NODE_ENV === "development" &&
  getEnv().HERMES_INBOX_POLLING_ENABLED
) {
  const INTERVAL_MS = 30_000;
  const RUN_BUDGET_MS = 20_000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    const controller = new AbortController();
    const deadline = Date.now() + RUN_BUDGET_MS;
    // Hard-abort the poll if it exceeds its budget — `shouldContinue` only
    // gates iterations between requests, so a single stuck HTTP call would
    // otherwise leave `running` pinned forever and silently disable the dev
    // poller until process restart.
    const watchdog = setTimeout(() => controller.abort(), RUN_BUDGET_MS);
    try {
      const summary = await hermesInboxSyncService.pollInboxes({
        abortSignal: controller.signal,
        deadlineMs: deadline,
        shouldContinue: () => Date.now() < deadline,
      });
      if (summary.polled > 0 || summary.totalMessages > 0) {
        console.log(
          `[dev/inbox-poll] polled=${summary.polled} messages=${summary.totalMessages}`,
        );
      }
    } catch (error) {
      console.warn("[dev/inbox-poll] failed", (error as Error)?.message);
    } finally {
      clearTimeout(watchdog);
      running = false;
    }
  };

  setTimeout(() => void tick(), 5_000);
  setInterval(() => void tick(), INTERVAL_MS);
  console.log(
    `[dev/inbox-poll] enabled — polling every ${INTERVAL_MS / 1000}s`,
  );
}
