import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";

import { notFound } from "./helpers/error";
import apiV1 from "./routes/v1";

let appInstance: Hono<{ Variables: RequestIdVariables }> | null = null;

function getApp(): Hono<{ Variables: RequestIdVariables }> {
  if (!appInstance) {
    const app = new Hono<{ Variables: RequestIdVariables }>();

    app.use(logger());
    app.use(requestId());
    app.use("*", cors());

    app.notFound(() => {
      throw notFound();
    });

    // Mount API v1 routes
    app.route("/v1", apiV1);

    appInstance = app;
  }
  return appInstance;
}

export default {
  port: process.env.PORT ?? 3000,
  fetch: (request: Request) => getApp().fetch(request),
};
