import { createNestedOpenAPIHono } from "@/lib/hono";

import mountGet from "./get.js";

const app = createNestedOpenAPIHono();

mountGet(app);

export default app;
