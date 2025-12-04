import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";

import { errorHandler } from "@/helpers/error-handler";

import agentsRouter from "./agents/index.js";
import jobsRouter from "./jobs/index.js";
import usersRouter from "./users/index.js";

const app = new OpenAPIHono<{ Variables: RequestIdVariables }>();

app.onError(errorHandler);

// Mount Routes
app.route("/agents", agentsRouter);
app.route("/users", usersRouter);
app.route("/jobs", jobsRouter);

export default app;
