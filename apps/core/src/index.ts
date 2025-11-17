import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId, type RequestIdVariables } from "hono/request-id";

import { getEnvSecrets } from "./config/env.js";
import { notFound } from "./helpers/error.js";
import apiV1 from "./routes/v1/index.js";

const app = new Hono<{ Variables: RequestIdVariables }>();

app.use(logger());
app.use(requestId());
app.use("*", cors());

app.notFound(() => {
  throw notFound();
});

app.get("/", (c) => c.text("Hello World!"));

// Mount API v1 routes
app.route("/v1", apiV1);

export default {
  port: getEnvSecrets().PORT,
  fetch: app.fetch,
};
