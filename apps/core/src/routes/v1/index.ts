import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";

import agentsRouter from "./agents/index.js";
import jobsRouter from "./jobs/index.js";
import usersRouter from "./users/index.js";

const app = new OpenAPIHono<{ Variables: RequestIdVariables }>();

// Mount Routes
app.route("/agents", agentsRouter);
app.route("/users", usersRouter);
app.route("/jobs", jobsRouter);

export default app;
