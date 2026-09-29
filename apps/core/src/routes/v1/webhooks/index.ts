import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";

import uploadedRouter from "./tasks/files/uploaded.js";

/**
 * Inbound webhooks (signature-verified, no user/coworker session auth).
 */
const app = new OpenAPIHono({
  defaultHook: defaultValidationHook,
});

app.route("/tasks/files", uploadedRouter);

export default app;
