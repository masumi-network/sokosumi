import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { logger } from "hono/logger";

import { env } from "./config/env";
import { errorHandler } from "./helpers/error-handler";
import agentsRouter from "./routes/agents";
import usersRouter from "./routes/users";

const app = new Hono();
app.use(logger());
app.use(bearerAuth({ token: env.API_KEY }));

// Centralized error handler
app.onError(errorHandler);

// Mount api routes
const api = new Hono();
api.route("/agents", agentsRouter);
api.route("/users", usersRouter);

// Mount api routes at /api/v1
app.route("/api/v1", api);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
