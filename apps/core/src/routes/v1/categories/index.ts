import { OpenAPIHono } from "@hono/zod-openapi";

import { defaultValidationHook } from "@/lib/hono";

import mountGetCategories from "./get.js";

// GET / is public catalog — anonymous list for cookie-free `'use cache'`.
// defaultValidationHook matches OpenAPIHonoWithAuth (422 on Zod failures).
const app = new OpenAPIHono({
  defaultHook: defaultValidationHook,
});

mountGetCategories(app);

export default app;
