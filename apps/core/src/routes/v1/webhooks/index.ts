import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";

import tasksRouter from "./tasks/index.js";

/**
 * Inbound webhooks (signature-verified, no user/coworker session auth).
 */
const app = new OpenAPIHono({
  defaultHook: defaultValidationHook,
});

app.route("/tasks", tasksRouter);

export default app;
