import { createNestedOpenAPIHono } from "@/lib/hono";

import mountCopy from "./copy.js";
import mountGet from "./get.js";

const app = createNestedOpenAPIHono();

mountGet(app);
mountCopy(app);

export default app;
