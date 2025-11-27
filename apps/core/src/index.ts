import "dotenv/config";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { RequestIdVariables } from "hono/request-id";
import { requestId } from "hono/request-id";

import { notFound } from "@/helpers/error";
import apiV1 from "@/routes/v1/index";

const app = new Hono<{ Variables: RequestIdVariables }>();

app.use(logger());
app.use(requestId());
app.use("*", cors());

app.notFound(() => {
  throw notFound();
});

// Mount API v1 routes
app.route("/v1", apiV1);

serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT) || 8787,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
