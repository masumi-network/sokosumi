import { createNestedOpenAPIHono } from "@/lib/hono";

import mountCreateAdminFreeCreditGrant from "./post.js";

const app = createNestedOpenAPIHono();

mountCreateAdminFreeCreditGrant(app);

export default app;
