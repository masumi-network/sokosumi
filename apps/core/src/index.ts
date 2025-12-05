import "dotenv/config";

import { serve } from "@hono/node-server";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { languageDetector } from "hono/language";
import { logger } from "hono/logger";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";

import { TIME } from "@/config/constants";
import { getEnv } from "@/config/env";
import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { initI18next } from "@/lib/i18next";
import { initSentry } from "@/lib/sentry";
import {
  type LanguageVariables,
  translationMiddleware,
} from "@/middleware/language";
import { sentryMiddleware } from "@/middleware/sentry";
import apiV1 from "@/routes/v1/index";

initSentry();

// Initialize i18next lazily to avoid top-level await
let i18nextInitialized = false;
async function ensureI18nextInitialized() {
  if (!i18nextInitialized) {
    await initI18next();
    i18nextInitialized = true;
  }
}

const app = new OpenAPIHono<{
  Variables: RequestIdVariables & LanguageVariables;
}>();

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

app.use(logger());
app.use(requestId());
app.use(sentryMiddleware());
app.use(
  languageDetector({
    supportedLanguages: ["en"], // Must include fallback
    fallbackLanguage: "en", // Required
    cookieOptions: {
      sameSite: "Lax", // Cookie same-site policy
    },
  }),
);
app.use(translationMiddleware());
app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    exposeHeaders: ["X-Request-Id", "Content-Length"],
    maxAge: TIME.CORS_MAX_AGE,
  }),
);

app.onError(errorHandler);

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
    fetch: async (request, server) => {
      // Ensure i18next is initialized before processing requests
      await ensureI18nextInitialized();
      return app.fetch(request, server);
    },
    port: getEnv().PORT,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
