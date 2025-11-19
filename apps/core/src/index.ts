import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId, type RequestIdVariables } from "hono/request-id";

import { getEnvSecrets } from "@/config/index.js";
import { notFound } from "@/helpers/error.js";
import apiV1 from "@/routes/v1/index.js";

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

const port = getEnvSecrets().PORT;

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`🚀 Server is running on http://localhost:${info.port}`);
  },
);
