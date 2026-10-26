import { createNestedOpenAPIHono } from "@/lib/hono";

import mountDelete from "./[id]/delete.js";
import mountGet from "./get.js";
import mountPut from "./put.js";

const app = createNestedOpenAPIHono();

mountGet(app);
mountPut(app);
mountDelete(app);

export default app;
