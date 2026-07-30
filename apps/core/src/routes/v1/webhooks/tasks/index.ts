import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";

import filesRouter from "./files/index.js";

const app = new OpenAPIHono({
  defaultHook: defaultValidationHook,
});

app.route("/files", filesRouter);

export default app;
