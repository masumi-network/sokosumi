import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountDelete from "./[id]/delete.js";
import mountPatch from "./[id]/patch.js";
import mountGet from "./get.js";
import mountPost from "./post.js";

const app = new OpenAPIHonoWithAuth();

mountPost(app);
mountGet(app);
mountPatch(app);
mountDelete(app);

export default app;
