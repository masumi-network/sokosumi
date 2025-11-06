import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { requestId, RequestIdVariables } from "hono/request-id";

import { env } from "./config/env";
import { errorHandler } from "./helpers/error-handler";
import apiV1 from "./routes/v1";

// const app = new Hono<{ Variables: RequestIdVariables }>();

// Protected API routes
const app = new Hono<{ Variables: RequestIdVariables }>();

app.use(logger());
app.use(requestId());
app.use("*", cors());

// Centralized error handler
app.onError(errorHandler);

// Mount API v1 routes
app.route("/v1", apiV1);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
