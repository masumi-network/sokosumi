import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId, type RequestIdVariables } from "hono/request-id";

import { notFound } from "./helpers/error";
import apiV1 from "./routes/v1";

console.log("[module-load]", import.meta.url);

const app = new Hono<{ Variables: RequestIdVariables }>();

app.use(logger());
app.use(requestId());
app.use("*", cors());

app.notFound(() => {
  throw notFound();
});

app.get("/", (c) => c.text("Hello Bun!"));

// Mount API v1 routes
app.route("/v1", apiV1);

export default {
  port: Bun.env.PORT ?? 3000,
  fetch: app.fetch,
};
