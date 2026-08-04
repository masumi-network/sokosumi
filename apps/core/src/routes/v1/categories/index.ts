import { OpenAPIHono } from "@hono/zod-openapi";

import mountGetCategories from "./get.js";

// GET / is public catalog — anonymous list for cookie-free `'use cache'`.
const app = new OpenAPIHono();

mountGetCategories(app);

export default app;
