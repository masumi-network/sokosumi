import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";

import uploadedRouter from "./uploaded.js";

const app = new OpenAPIHono({
  defaultHook: defaultValidationHook,
});

app.route("/", uploadedRouter);

export default app;
