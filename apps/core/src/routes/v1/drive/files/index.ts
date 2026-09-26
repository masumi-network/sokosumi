import { createNestedOpenAPIHono } from "@/lib/hono";

import mountDelete from "./[id]/delete.js";
import mountPatch from "./[id]/patch.js";
import mountGet from "./get.js";
import mountMove from "./move.js";
import mountPost from "./post.js";

const app = createNestedOpenAPIHono();

mountPost(app);
mountGet(app);
mountMove(app);
mountPatch(app);
mountDelete(app);

export default app;
