import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";

import { notFound } from "./helpers/error";

const app = new Hono<{ Variables: RequestIdVariables }>();

app.use(logger());
app.use(requestId());
app.use("*", cors());

app.notFound(() => {
  throw notFound();
});

// Mount API v1 routes
app.get("/v1", (c) => c.text("Hono!"));

export default {
  port: Bun.env.PORT ?? 3000,
  fetch: app.fetch,
};
