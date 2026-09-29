import { createNestedOpenAPIHono } from "@/lib/hono";

import mountListAdminUsers from "./get.js";

const app = createNestedOpenAPIHono();

mountListAdminUsers(app);

export default app;
