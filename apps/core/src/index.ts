import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { logger } from "hono/logger";

import { env } from "./config/env";
import { errorHandler } from "./helpers/error-handler";
import agentsRouter from "./routes/agents";
import usersRouter from "./routes/users";

const app = new Hono().basePath("/api/v1");
app.use(logger());
app.use(bearerAuth({ token: env.API_KEY }));

// Centralized error handler
app.onError(errorHandler);

// Mount agents routes at /api/v1/
app.route("/agents", agentsRouter);
app.route("/users", usersRouter);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
