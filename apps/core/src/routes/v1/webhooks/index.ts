import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";

import driveRouter from "./drive/index.js";
import tasksRouter from "./tasks/index.js";

/**
 * Inbound webhooks (signature-verified, no user/coworker session auth).
 */
const app = new OpenAPIHono({
  defaultHook: defaultValidationHook,
});

app.route("/tasks", tasksRouter);
app.route("/drive", driveRouter);

export default app;
