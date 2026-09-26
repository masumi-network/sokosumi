import { createNestedOpenAPIHono } from "@/lib/hono";

import mountDelete from "./[id]/delete.js";
import mountGet from "./get.js";
import mountPost from "./post.js";

const app = createNestedOpenAPIHono();

mountGet(app);
mountPost(app);
mountDelete(app);

export default app;
