import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import { env } from "./config/env";
import { errorHandler } from "./helpers/error-handler";
import agentsRouter from "./routes/agents";
import usersRouter from "./routes/users";

const app = new Hono();
app.use(logger());
app.use(prettyJSON());

// Centralized error handler
app.onError(errorHandler);

// Mount api routes
const api = new OpenAPIHono();
// api.use(bearerAuth({ token: env.API_KEY }));
api.route("/agents", agentsRouter);
api.route("/users", usersRouter);

api.doc("/doc", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "My API",
  },
});

// Mount api routes at /api/v1
app.route("/api/v1", api);

export default {
  port: env.PORT,
  fetch: app.fetch,
};
