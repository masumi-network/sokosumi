import { OpenAPIHono } from "@hono/zod-openapi";

import jobsRouter from "./jobs/index.js";

const app = new OpenAPIHono();

app.route("/jobs", jobsRouter);

export default app;
