import { createNestedOpenAPIHono } from "@/lib/hono";

import mountPatch from "./[id]/patch.js";
import mountGet from "./get.js";
import mountPost from "./post.js";

const app = createNestedOpenAPIHono();

mountGet(app);
mountPost(app);
mountPatch(app);

export default app;
