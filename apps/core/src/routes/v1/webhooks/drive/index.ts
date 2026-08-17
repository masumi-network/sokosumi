import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";

import driveFilesUploadedRouter from "./files/uploaded.js";

const app = new OpenAPIHono({
  defaultHook: defaultValidationHook,
});

app.route("/files", driveFilesUploadedRouter);

export default app;
