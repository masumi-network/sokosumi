import { createNestedOpenAPIHono } from "@/lib/hono";

import mountGetAdminPreprodPause from "./preprod/pause/get.js";
import mountSetAdminPreprodPause from "./preprod/pause/put.js";

const app = createNestedOpenAPIHono();

mountGetAdminPreprodPause(app);
mountSetAdminPreprodPause(app);

export default app;
