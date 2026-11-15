import { createNestedOpenAPIHono } from "@/lib/hono";

import mountGet from "./get.js";
import mountPut from "./put.js";

const app = createNestedOpenAPIHono();

mountGet(app);
mountPut(app);

export default app;
